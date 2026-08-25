-- Follow-up to add-direct-messages.
--
-- The core migration protects the channel/message tables themselves. These are
-- the secondary side effects and agent records that can also carry private
-- channel content or identifiers, so they inherit the same boundary here.

-- Agent activity carries the source channel id (and sometimes the source
-- message id or a scheduled prompt). Keep those records behind the source
-- conversation's visibility rule.
DROP POLICY "admins read agent runs" ON public.agent_runs;
CREATE POLICY "admins read agent runs"
ON public.agent_runs FOR SELECT TO authenticated
USING (
  public.is_admin()
  AND (channel_id IS NULL OR public.can_read_channel(channel_id))
);

DROP POLICY "active members read agent schedules" ON public.agent_schedules;
CREATE POLICY "active members read agent schedules"
ON public.agent_schedules FOR SELECT TO authenticated
USING (public.can_read_channel(channel_id));

-- A human mentioned inside a DM must not receive a notification containing the
-- private message unless they are one of the two participants. This trigger is
-- deliberately on notifications rather than only in messages_fan_out(): it is
-- the last line of defence for every present and future channel notification.
CREATE OR REPLACE FUNCTION public.notifications_guard_dm_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.channel_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.channels c
    WHERE c.id = NEW.channel_id
      AND (
        c.kind <> 'dm'
        OR NEW.user_id IN (c.dm_user_a, c.dm_user_b)
      )
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_guard_dm_recipient
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.notifications_guard_dm_recipient();

-- Mention rows are private-channel metadata too. Dropping an outsider mention
-- keeps participants from seeing a misleading mention record and pairs with the
-- notification guard above to prevent the message body escaping.
CREATE OR REPLACE FUNCTION public.message_mentions_guard_dm_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.channels c ON c.id = m.channel_id
    WHERE m.id = NEW.message_id
      AND c.kind = 'dm'
      AND NEW.mentioned_user_id NOT IN (c.dm_user_a, c.dm_user_b)
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER message_mentions_guard_dm_recipient
BEFORE INSERT ON public.message_mentions
FOR EACH ROW EXECUTE FUNCTION public.message_mentions_guard_dm_recipient();

-- Agents are channel participants only through explicit room mentions. DMs are
-- human-to-human, so mentioning an agent handle there must not enqueue a run
-- whose admin client could then read the private thread.
CREATE OR REPLACE FUNCTION public.messages_queue_agent_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_handle TEXT;
  ag public.agents;
BEGIN
  IF NEW.kind <> 'human' OR EXISTS (
    SELECT 1 FROM public.channels
    WHERE id = NEW.channel_id AND kind = 'dm'
  ) THEN
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

-- Scheduled agents are another route into a channel. Refuse a DM target at the
-- table boundary so UI changes or service-role writes cannot bypass the rule.
CREATE OR REPLACE FUNCTION public.agent_schedules_reject_dm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.channels
    WHERE id = NEW.channel_id AND kind = 'dm'
  ) THEN
    RAISE EXCEPTION 'agents cannot be scheduled in a direct message';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_schedules_reject_dm
BEFORE INSERT OR UPDATE OF channel_id ON public.agent_schedules
FOR EACH ROW EXECUTE FUNCTION public.agent_schedules_reject_dm();
