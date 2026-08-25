-- Collaboration layer, part 2: agents, the OpenRouter credential, and the
-- propose-only protocol.
--
-- Two security boundaries carry this file. Neither is negotiable.
--
-- BOUNDARY 1 — the OpenRouter key. Same shape as github_connection and for the
-- same reason: the app only ever builds a per-user client, so anything an admin's
-- session can SELECT, that admin's browser can also pull straight from PostgREST
-- with the public anon key. openrouter_connection therefore carries NO grants to
-- anon or authenticated at all. Only the edge functions, holding the service API
-- key, ever read it, and the key is stored AES-GCM encrypted under
-- OPENROUTER_KEY_SECRET which lives in the function environment and never in this
-- database. Admins read STATUS through a SECURITY DEFINER function that
-- structurally cannot return the ciphertext.
--
-- BOUNDARY 2 — propose-only. An agent never mutates the record. It writes an
-- agent_proposals row and stops. decide_agent_proposal is the only path from a
-- proposal to a change, and the thing that makes it safe is subtle enough to
-- state plainly:
--
--   A SECURITY DEFINER function does NOT enforce the target table's RLS, because
--   it runs as the function owner. So every direct table write below re-derives,
--   by hand and in full, exactly what that table's INSERT policy would have
--   required — including pinning author_id to the APPROVER's auth.uid().
--   Delegated RPCs (advance_lifecycle_phase) are different: their permission
--   logic is written in the function body rather than in RLS, and auth.uid()
--   reads a session setting that SECURITY DEFINER does not change, so calling
--   them re-derives against the approver correctly and must NOT be second-guessed
--   here.
--
-- Get that distinction wrong in either direction and the gate model is decoration
-- again, this time from the inside.

-- ============================================================
-- openrouter_connection
-- ============================================================
-- Singleton, same one-row guard as github_connection: a second INSERT collides on
-- the primary key rather than creating a rival configuration.
--
-- On "should be a test key": OpenRouter's GET /api/v1/key reports the key's
-- spend limit and whether it is free tier. A key with a NULL limit is uncapped —
-- exactly what you do not want holding the door open for an unattended schedule.
-- The limit is recorded at validation time so key_is_capped can be reported
-- honestly, and the settings panel warns loudly on an uncapped key. It is a
-- warning rather than a hard rejection because an org that has capped spend at
-- the account level rather than the key level is not doing anything wrong.

CREATE TABLE public.openrouter_connection (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  key_ciphertext TEXT,
  key_iv TEXT,
  key_last_four TEXT
    CHECK (key_last_four IS NULL OR char_length(key_last_four) = 4),
  -- Reported by OpenRouter, not typed by the admin.
  key_label TEXT,
  key_limit_usd NUMERIC(12,4),
  key_usage_usd NUMERIC(12,4),
  key_is_free_tier BOOLEAN,
  validated_at TIMESTAMPTZ,
  validation_error TEXT,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ciphertext and IV are useless apart; never store one without the other.
  CONSTRAINT openrouter_connection_key_complete CHECK (
    num_nonnulls(key_ciphertext, key_iv) IN (0, 2)
  )
);

CREATE TRIGGER openrouter_connection_updated_at
BEFORE UPDATE ON public.openrouter_connection
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.openrouter_connection ENABLE ROW LEVEL SECURITY;

-- No policies and no grants, deliberately: there is no client path to this table
-- in any role. Read that as the security boundary, not as an oversight.
REVOKE ALL ON public.openrouter_connection FROM anon, authenticated;

INSERT INTO public.openrouter_connection (id) VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

-- Every column EXCEPT key_ciphertext and key_iv, so the credential cannot leak
-- through this path even if the function is called directly. Zero rows for
-- non-admins.
CREATE OR REPLACE FUNCTION public.openrouter_connection_status()
RETURNS TABLE (
  is_configured BOOLEAN,
  key_last_four TEXT,
  key_label TEXT,
  key_limit_usd NUMERIC,
  key_usage_usd NUMERIC,
  key_is_free_tier BOOLEAN,
  key_is_capped BOOLEAN,
  validated_at TIMESTAMPTZ,
  validation_error TEXT,
  connected_by UUID,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    c.key_ciphertext IS NOT NULL,
    c.key_last_four,
    c.key_label,
    c.key_limit_usd,
    c.key_usage_usd,
    c.key_is_free_tier,
    c.key_limit_usd IS NOT NULL,
    c.validated_at,
    c.validation_error,
    c.connected_by,
    c.updated_at
  FROM public.openrouter_connection c
  WHERE public.is_admin();
$$;

GRANT EXECUTE ON FUNCTION public.openrouter_connection_status() TO authenticated;

-- Members who are not admins still need the one bit that tells them whether
-- mentioning an agent will do anything at all.
CREATE OR REPLACE FUNCTION public.openrouter_is_configured()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.is_active_member() AND EXISTS (
    SELECT 1 FROM public.openrouter_connection WHERE key_ciphertext IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.openrouter_is_configured() TO authenticated;

-- ============================================================
-- agents
-- ============================================================
-- 1:1 sidecar on team_members. Adding an agent is an INSERT, not a migration.

CREATE TABLE public.agents (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- What you type after the @. Lowercase and unique so mention matching is exact;
  -- a fuzzy match that wakes the wrong agent is worse than one that misses.
  handle TEXT NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9][a-z0-9_-]{1,29}$'),
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  system_prompt TEXT NOT NULL CHECK (char_length(btrim(system_prompt)) BETWEEN 1 AND 20000),

  -- The OpenRouter model slug, pasted verbatim from openrouter.ai/models —
  -- 'anthropic/claude-sonnet-4.5', 'perplexity/sonar',
  -- 'meta-llama/llama-3.3-70b-instruct:free'. Stored as typed and sent as typed:
  -- OpenRouter owns this namespace and it changes without us, so validating
  -- against a list we maintain would mean a new model needs a deploy. The CHECK
  -- only asserts the shape, and an unknown slug fails loudly at call time with
  -- OpenRouter's own error, which is more useful than ours would be.
  model TEXT NOT NULL
    CHECK (model ~ '^[a-z0-9._-]+/[A-Za-z0-9._-]+(:[A-Za-z0-9-]+)?$'),

  -- D4 containment: what this agent may propose. Checked in
  -- decide_agent_proposal, so a prompt injection that talks @scout into
  -- advancing a lifecycle phase still produces a rejected proposal.
  allowed_actions TEXT[] NOT NULL DEFAULT '{}'
    CHECK (allowed_actions <@ ARRAY[
      'knowledge_note', 'task_create', 'task_update',
      'status_update', 'lifecycle_advance'
    ]::TEXT[]),

  -- Sampling knobs kept deliberately few. Anything else belongs in the prompt.
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.30
    CHECK (temperature >= 0 AND temperature <= 2),
  max_output_tokens INTEGER NOT NULL DEFAULT 1500
    CHECK (max_output_tokens BETWEEN 256 AND 32000),

  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Hard ceiling per calendar month, enforced in the edge function before the
  -- call is made. trend-scan taught us that a schedule nobody owns is a bill.
  budget_usd_month NUMERIC(10,2) NOT NULL DEFAULT 5.00
    CHECK (budget_usd_month >= 0),

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agents_enabled_idx ON public.agents (handle) WHERE enabled;

CREATE TRIGGER agents_updated_at
BEFORE UPDATE ON public.agents
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- An agents row must point at a team_members row marked kind='agent'. Without
-- this the two tables can disagree about what something is.
CREATE OR REPLACE FUNCTION public.validate_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = NEW.user_id AND kind = 'agent'
  ) THEN
    RAISE EXCEPTION 'agent user must have a team_members row with kind = agent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agents_validate
BEFORE INSERT OR UPDATE ON public.agents
FOR EACH ROW EXECUTE FUNCTION public.validate_agent();

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- Everyone sees the roster: knowing which agent to mention, what it is for, and
-- what it is allowed to propose is the point. system_prompt is included — an
-- agent whose instructions the team cannot read is not one they can trust.
CREATE POLICY "active members read agents"
ON public.agents FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "admins create agents"
ON public.agents FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "admins update agents"
ON public.agents FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

REVOKE ALL ON public.agents FROM anon, authenticated;
GRANT SELECT ON public.agents TO authenticated;
GRANT INSERT (
  user_id, handle, display_name, description, system_prompt, model,
  allowed_actions, temperature, max_output_tokens, enabled, budget_usd_month,
  created_by
) ON public.agents TO authenticated;
GRANT UPDATE (
  display_name, description, system_prompt, model, allowed_actions,
  temperature, max_output_tokens, enabled, budget_usd_month
) ON public.agents TO authenticated;

-- ============================================================
-- agent_runs
-- ============================================================
-- Cost and outcome of every model call, following scan_runs. Written only by the
-- edge function; admin-read, because spend is an admin concern and the table
-- would otherwise be a per-message activity log for everyone.

CREATE TABLE public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES public.agents(user_id) ON DELETE SET NULL,
  trigger_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  schedule_id UUID,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  -- Recorded per run, not read back from agents.model: the slug can be changed
  -- between runs and this row has to stay true about what actually answered.
  model TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd NUMERIC(12,6),
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_runs_agent_idx ON public.agent_runs (agent_id, created_at DESC);

-- The drain queue, partial so it stays tiny however many runs accumulate —
-- exactly the shape notifications uses for its pending email.
CREATE INDEX agent_runs_pending_idx
ON public.agent_runs (created_at)
WHERE status = 'pending';

-- Month-to-date spend per agent, which is what the budget check reads.
CREATE INDEX agent_runs_cost_idx
ON public.agent_runs (agent_id, created_at)
WHERE cost_usd IS NOT NULL;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read agent runs"
ON public.agent_runs FOR SELECT TO authenticated
USING (public.is_admin());

REVOKE ALL ON public.agent_runs FROM anon, authenticated;
GRANT SELECT ON public.agent_runs TO authenticated;

-- phase_artifacts.agent_run_id has been sitting unconstrained since M9, reserved
-- for exactly this table. Wire it up now that the table exists.
ALTER TABLE public.phase_artifacts
  ADD CONSTRAINT phase_artifacts_agent_run_id_fkey
  FOREIGN KEY (agent_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

-- ============================================================
-- agent_proposals
-- ============================================================

CREATE TABLE public.agent_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(user_id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,

  action TEXT NOT NULL CHECK (action IN (
    'knowledge_note', 'task_create', 'task_update',
    'status_update', 'lifecycle_advance'
  )),
  payload JSONB NOT NULL,
  -- Why the agent thinks this. Shown in full on the proposal card: an approver
  -- deciding from a summary is the failure mode this whole design exists to stop.
  reasoning TEXT NOT NULL CHECK (char_length(btrim(reasoning)) BETWEEN 1 AND 5000),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded', 'expired')),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  -- What it became, once approved.
  result_type TEXT,
  result_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_proposals_decision_complete CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending')
  )
);

CREATE INDEX agent_proposals_message_idx ON public.agent_proposals (message_id);
CREATE INDEX agent_proposals_pending_idx
ON public.agent_proposals (channel_id, created_at DESC)
WHERE status = 'pending';

ALTER TABLE public.agent_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read proposals"
ON public.agent_proposals FOR SELECT TO authenticated
USING (public.is_active_member());

-- SELECT and nothing else. Proposals are written by the edge function through the
-- admin client, and the ONLY way one changes state is decide_agent_proposal. No
-- INSERT grant means a member cannot fabricate a proposal and approve it to
-- borrow authority they do not have; no UPDATE grant means they cannot flip one
-- to 'approved' without going through the checks.
REVOKE ALL ON public.agent_proposals FROM anon, authenticated;
GRANT SELECT ON public.agent_proposals TO authenticated;

-- ============================================================
-- decide_agent_proposal
-- ============================================================
-- The only path from a proposal to a change in the record.
--
-- Read the header note on BOUNDARY 2 before editing this. In short: this function
-- is SECURITY DEFINER, so the target tables' RLS does NOT run. Every direct write
-- below therefore repeats that table's INSERT policy by hand. When you add an
-- action, go and read the policy on the table you are writing to and mirror it
-- here — do not assume RLS has your back, because here it does not.
--
-- p_waiver_reason is a parameter and never comes from payload. An AI-drafted
-- justification for waiving a security gate, recorded in the waiver register as
-- an admin's own words, would make /governance a liability rather than a control.

CREATE OR REPLACE FUNCTION public.decide_agent_proposal(
  p_proposal_id UUID,
  p_decision TEXT,
  p_decision_note TEXT DEFAULT NULL,
  p_waiver_reason TEXT DEFAULT NULL
)
RETURNS public.agent_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  prop public.agent_proposals;
  ag public.agents;
  payload JSONB;
  new_id UUID;
  new_type TEXT;
  target_task public.product_tasks;
  waiver TEXT := nullif(btrim(coalesce(p_waiver_reason, '')), '');
  result public.agent_proposals;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'decision must be approve or reject';
  END IF;

  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'only active members can decide proposals';
  END IF;

  -- FOR UPDATE: two people hitting Approve on the same card must not both
  -- execute it. The loser finds status <> pending and is told so.
  SELECT * INTO prop FROM public.agent_proposals
  WHERE id = p_proposal_id FOR UPDATE;

  IF prop.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found';
  END IF;

  IF prop.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal has already been %', prop.status;
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.agent_proposals
    SET status = 'rejected',
        decided_by = actor,
        decided_at = now(),
        decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
    WHERE id = prop.id
    RETURNING * INTO result;
    RETURN result;
  END IF;

  -- ---------- D4: the agent's own allowlist ----------
  SELECT * INTO ag FROM public.agents WHERE user_id = prop.agent_id;

  IF ag.user_id IS NULL THEN
    RAISE EXCEPTION 'proposing agent no longer exists';
  END IF;

  IF NOT ag.enabled THEN
    RAISE EXCEPTION 'agent % is disabled', ag.handle;
  END IF;

  -- The containment that survives prompt injection: whatever the agent was
  -- talked into proposing, it cannot be approved into an action outside this list.
  IF NOT (prop.action = ANY (ag.allowed_actions)) THEN
    RAISE EXCEPTION 'agent % is not permitted to propose %', ag.handle, prop.action;
  END IF;

  payload := prop.payload;

  -- ---------- Execute, re-deriving the approver's own authority ----------
  IF prop.action = 'knowledge_note' THEN
    -- Mirrors: is_active_member() AND author_id = auth.uid()
    INSERT INTO public.knowledge_items (kind, title, content, status, author_id)
    VALUES (
      'note',
      payload ->> 'title',
      payload ->> 'content',
      'draft',
      actor
    )
    RETURNING id INTO new_id;
    new_type := 'knowledge_item';

    IF prop.product_id IS NOT NULL THEN
      INSERT INTO public.knowledge_item_products (knowledge_item_id, product_id)
      VALUES (new_id, prop.product_id)
      ON CONFLICT DO NOTHING;
    END IF;

  ELSIF prop.action = 'task_create' THEN
    -- Mirrors: is_active_member() AND created_by = auth.uid()
    INSERT INTO public.product_tasks (
      product_id, parent_task_id, title, notes, due_date, assignee_id, created_by
    )
    VALUES (
      coalesce((payload ->> 'product_id')::UUID, prop.product_id),
      (payload ->> 'parent_task_id')::UUID,
      payload ->> 'title',
      payload ->> 'notes',
      (payload ->> 'due_date')::DATE,
      (payload ->> 'assignee_id')::UUID,
      actor
    )
    RETURNING id INTO new_id;
    new_type := 'product_task';

  ELSIF prop.action = 'task_update' THEN
    -- Mirrors: is_active_member(), and the column grant, which allows exactly
    -- these six columns and no others.
    SELECT * INTO target_task FROM public.product_tasks
    WHERE id = (payload ->> 'task_id')::UUID;

    IF target_task.id IS NULL THEN
      RAISE EXCEPTION 'task in proposal no longer exists';
    END IF;

    UPDATE public.product_tasks
    SET title       = coalesce(payload ->> 'title', title),
        notes       = coalesce(payload ->> 'notes', notes),
        due_date    = coalesce((payload ->> 'due_date')::DATE, due_date),
        assignee_id = coalesce((payload ->> 'assignee_id')::UUID, assignee_id),
        status      = coalesce(payload ->> 'status', status)
    WHERE id = target_task.id
    RETURNING id INTO new_id;
    new_type := 'product_task';

  ELSIF prop.action = 'status_update' THEN
    -- Mirrors: is_active_member() AND author_id = auth.uid()
    --          AND source_type = 'manual'
    --
    -- The approver is the author, deliberately. They are the one accountable for
    -- the change; the agent's fingerprint goes in source_ref, which is visible
    -- but not load-bearing. This is why status_updates needs no migration.
    INSERT INTO public.status_updates (
      product_id, author_id, source_type, source_ref, health, stage, summary, details
    )
    VALUES (
      coalesce((payload ->> 'product_id')::UUID, prop.product_id),
      actor,
      'manual',
      jsonb_build_object(
        'via', 'agent',
        'agent', ag.handle,
        'model', ag.model,
        'proposal_id', prop.id,
        'message_id', prop.message_id,
        'run_id', prop.run_id
      ),
      payload ->> 'health',
      payload ->> 'stage',
      payload ->> 'summary',
      payload ->> 'details'
    )
    RETURNING id INTO new_id;
    new_type := 'status_update';

  ELSIF prop.action = 'lifecycle_advance' THEN
    -- Delegated, NOT re-implemented. advance_lifecycle_phase carries its permission
    -- logic in its body rather than in RLS, and auth.uid() reads a session setting
    -- that SECURITY DEFINER does not change — so it re-derives against the approver
    -- and raises if they are not entitled. A member approving a high-risk advance
    -- is rejected here, by that function, exactly as if they had clicked it
    -- themselves.
    --
    -- waiver comes from the approver's parameter. Any waiver_reason the agent put
    -- in payload is ignored on purpose and is not read anywhere in this branch.
    PERFORM public.advance_lifecycle_phase(
      (payload ->> 'phase_id')::UUID,
      payload ->> 'state',
      waiver
    );
    new_id := (payload ->> 'phase_id')::UUID;
    new_type := 'lifecycle_phase';

  ELSE
    RAISE EXCEPTION 'unknown proposal action %', prop.action;
  END IF;

  -- ---------- Close the loop back to the conversation ----------
  UPDATE public.agent_proposals
  SET status = 'approved',
      decided_by = actor,
      decided_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), ''),
      result_type = new_type,
      result_id = new_id
  WHERE id = prop.id
  RETURNING * INTO result;

  UPDATE public.messages
  SET promoted_to_type = new_type,
      promoted_to_id = new_id
  WHERE id = prop.message_id;

  -- Any other pending proposal from the same run is now stale: the agent offered
  -- alternatives and one was taken.
  UPDATE public.agent_proposals
  SET status = 'superseded', decided_at = now()
  WHERE run_id IS NOT NULL
    AND run_id = prop.run_id
    AND id <> prop.id
    AND status = 'pending';

  -- Tell the agent's audience what happened. The agent itself has no inbox, so
  -- this goes to whoever asked for it.
  INSERT INTO public.notifications (
    user_id, type, message_id, channel_id, actor_id, title, body
  )
  SELECT DISTINCT m.author_id, 'proposal_decided', prop.message_id, prop.channel_id,
         actor,
         '@' || ag.handle || ' proposal approved',
         left(prop.reasoning, 2000)
  FROM public.messages m
  WHERE m.id = (
    SELECT parent_id FROM public.messages WHERE id = prop.message_id
  )
  AND m.author_id IS NOT NULL
  AND m.author_id <> actor;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_agent_proposal(UUID, TEXT, TEXT, TEXT)
TO authenticated;

-- ============================================================
-- Agent mention routing
-- ============================================================
-- The human mention trigger in part 1 matches team_members.display_name. Agents
-- are matched on agents.handle instead, which is what the @ in the composer
-- completes against, and a match queues a run rather than a notification.
--
-- Queue-then-ping, the same shape as the notification email drain: this trigger
-- only writes the pending row, the Server Action pings the function for
-- responsiveness, and agent-tick drains whatever the ping missed. A trigger that
-- made the HTTP call itself would put an external service inside the
-- transaction that is inserting the message.

CREATE OR REPLACE FUNCTION public.messages_queue_agent_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  -- v_ prefix, not `handle`: PL/pgSQL resolves an unqualified `handle` in the
  -- lookup below against the variable AND against agents.handle, and raises
  -- "column reference is ambiguous" at run time rather than at create time.
  v_handle TEXT;
  ag public.agents;
BEGIN
  -- Agents do not answer agents. Without this, two agents mentioning each other
  -- is an unbounded billable loop.
  IF NEW.kind <> 'human' THEN
    RETURN NEW;
  END IF;

  FOR v_handle IN
    SELECT DISTINCT lower(m[1])
    FROM regexp_matches(NEW.body, '@([A-Za-z0-9._-]{2,40})', 'g') AS m
  LOOP
    SELECT * INTO ag FROM public.agents
    WHERE agents.handle = v_handle AND enabled;

    IF ag.user_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.agent_runs (
      agent_id, trigger_message_id, channel_id, model, status
    )
    VALUES (ag.user_id, NEW.id, NEW.channel_id, ag.model, 'pending');
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_queue_agent_runs
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_queue_agent_runs();

-- Month-to-date spend for one agent. Read by the edge function before it calls
-- OpenRouter, and by the admin cost panel.
CREATE OR REPLACE FUNCTION public.agent_spend_this_month(p_agent_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(sum(cost_usd), 0)
  FROM public.agent_runs
  WHERE agent_id = p_agent_id
    AND created_at >= date_trunc('month', now());
$$;

GRANT EXECUTE ON FUNCTION public.agent_spend_this_month(UUID) TO authenticated;
