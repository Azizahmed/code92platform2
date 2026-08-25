-- Collaboration layer, part 3: scheduled agent runs.
--
-- InsForge's schedules.jobs is not writable by the app's role — trend-scan.ts
-- records that it is not writable even by the CLI's role. Agents therefore cannot
-- create InsForge schedules at runtime, and should not: scheduling owned here
-- gets RLS, per-agent budgets, an audit trail and a per-job kill switch, none of
-- which a row in someone else's infrastructure table would have.
--
-- Exactly ONE InsForge schedule backs this file:
--
--   agent-tick  (*/5 * * * *)  →  functions/agent-tick.ts
--
-- provisioned once and never touched again. Everything else is rows.

CREATE TABLE public.agent_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(user_id) ON DELETE CASCADE,
  -- Where the agent posts. Required: a scheduled run with nowhere to speak is a
  -- billable no-op.
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  -- Optional narrowing. When the channel is product-bound this is redundant and
  -- the tick fills it from the channel.
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,

  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  -- What to do on each firing, in the same voice a person would use in the
  -- channel. The agent's system_prompt still applies; this is the errand.
  prompt TEXT NOT NULL CHECK (char_length(btrim(prompt)) BETWEEN 1 AND 5000),

  -- Five-field cron, validated by shape here and parsed by the tick. Deliberately
  -- not a free string: a typo that parses as "every minute" is a bill.
  cron TEXT NOT NULL CHECK (
    cron ~ '^(\S+\s+){4}\S+$'
  ),
  -- Minimum gap between firings, belt-and-braces against a cron that resolves
  -- tighter than intended. The tick honours whichever is later.
  min_interval_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (min_interval_minutes >= 15),

  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_schedules_due_idx
ON public.agent_schedules (next_run_at)
WHERE enabled;

CREATE INDEX agent_schedules_agent_idx ON public.agent_schedules (agent_id);

CREATE TRIGGER agent_schedules_updated_at
BEFORE UPDATE ON public.agent_schedules
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.agent_schedules ENABLE ROW LEVEL SECURITY;

-- Everyone can see what is scheduled. An unattended agent posting into a channel
-- on a cadence nobody can inspect is how you lose trust in the whole feature.
CREATE POLICY "active members read agent schedules"
ON public.agent_schedules FOR SELECT TO authenticated
USING (public.is_active_member());

-- D5: admins only. An unattended AI run spends money on its own cadence, which
-- is the same class of decision as activating a member.
CREATE POLICY "admins create agent schedules"
ON public.agent_schedules FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "admins update agent schedules"
ON public.agent_schedules FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "admins delete agent schedules"
ON public.agent_schedules FOR DELETE TO authenticated
USING (public.is_admin());

REVOKE ALL ON public.agent_schedules FROM anon, authenticated;
GRANT SELECT, DELETE ON public.agent_schedules TO authenticated;
GRANT INSERT (
  agent_id, channel_id, product_id, name, prompt, cron,
  min_interval_minutes, enabled, created_by
) ON public.agent_schedules TO authenticated;
-- next_run_at and last_run_at are absent: only the tick moves the clock. An admin
-- who could set next_run_at could make a job fire continuously.
GRANT UPDATE (
  name, prompt, cron, min_interval_minutes, enabled, channel_id, product_id
) ON public.agent_schedules TO authenticated;

-- agent_runs.schedule_id was left unconstrained in part 2 because this table did
-- not exist yet.
ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES public.agent_schedules(id) ON DELETE SET NULL;

-- A schedule edit that changes cadence should take effect from now, not from
-- whatever the old cron had already booked.
CREATE OR REPLACE FUNCTION public.agent_schedules_reset_clock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.cron IS DISTINCT FROM OLD.cron
     OR NEW.min_interval_minutes IS DISTINCT FROM OLD.min_interval_minutes
     OR (NEW.enabled AND NOT OLD.enabled) THEN
    NEW.next_run_at := now();
    NEW.last_error := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_schedules_reset_clock
BEFORE UPDATE ON public.agent_schedules
FOR EACH ROW EXECUTE FUNCTION public.agent_schedules_reset_clock();
