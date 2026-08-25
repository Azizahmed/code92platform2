-- Retiring an agent.
--
-- Deliberately NOT a DELETE. agent_proposals.agent_id is ON DELETE CASCADE, so
-- dropping an agents row would take its proposal history with it — including
-- approved proposals whose decisions produced real status updates, tasks and
-- lifecycle advances. The register of who approved what is the thing the
-- propose-only design exists to produce; tidying the roster must not be able to
-- erase it. agent_runs is ON DELETE SET NULL, so the spend record would survive
-- but lose its owner, which is worse than either keeping or removing it.
--
-- So "remove" is archived_at. The agent leaves the roster, stops answering
-- mentions, stops firing on its schedules — and everything it ever proposed
-- stays exactly where it is, still attributable.
--
-- `enabled` remains a separate thing: a reversible pause an admin toggles from
-- the roster. archived_at is the one-way door.

ALTER TABLE public.agents
  ADD COLUMN archived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.agents.archived_at IS
  'Set when an admin removes the agent. Rows are kept so agent_proposals and '
  'agent_runs stay attributable; the roster and the mention trigger both skip '
  'archived agents.';

-- Only archived_at is added to the client grant. handle and user_id stay
-- unwritable for the same reason as before: identity is not editable.
GRANT UPDATE (archived_at) ON public.agents TO authenticated;

-- The mention router already skipped disabled agents. It now also skips archived
-- ones outright, so an archived agent cannot be talked into answering by an
-- admin flipping `enabled` back on somewhere the roster no longer shows it.
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
    WHERE agents.handle = v_handle AND enabled AND archived_at IS NULL;

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

-- agent-tick selects due schedules by agent_schedules.enabled alone; it does not
-- join agents. Rather than teach the tick about archiving, archiving switches the
-- schedules off here — one statement, and the tick keeps its simple query.
CREATE OR REPLACE FUNCTION public.agents_archive_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    UPDATE public.agent_schedules
    SET enabled = false
    WHERE agent_id = NEW.user_id AND enabled;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agents_archive_cascade
AFTER UPDATE OF archived_at ON public.agents
FOR EACH ROW EXECUTE FUNCTION public.agents_archive_cascade();
