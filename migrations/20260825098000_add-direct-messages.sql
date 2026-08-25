-- Direct messages.
--
-- A DM is a third channel kind. It reuses the whole messages/mentions/threading
-- stack, so a private conversation behaves exactly like a room: threads, edits,
-- read state, notifications. What it does NOT reuse is the visibility rule.
--
-- Every SELECT policy on this stack currently reads "any active member may read
-- it", which is right for rooms the team shares and catastrophic for a DM. This
-- migration is therefore mostly a privacy migration: channels, messages,
-- channel_members, message_mentions and agent_proposals all gain a rule that
-- excludes a DM the caller is not part of.
--
-- The participants live in two columns ON THE CHANNEL ROW, not in
-- channel_members. That table's own header says it is "follow state and read
-- position, not an access control list", and its INSERT policy lets anyone join
-- themselves to any channel — so if membership were the ACL, reading someone
-- else's DM would be one self-insert away. Two immutable columns that no client
-- role may write are a much smaller thing to get right.
--
-- The pair is stored in a fixed order (dm_user_a < dm_user_b) so that one
-- conversation is one row no matter who opens it first, enforced by a unique
-- index rather than by whoever writes the insert.

-- ============================================================
-- channels: the dm kind and its two participants
-- ============================================================

ALTER TABLE public.channels
  DROP CONSTRAINT channels_kind_check;

ALTER TABLE public.channels
  ADD CONSTRAINT channels_kind_check
    CHECK (kind IN ('standing', 'product', 'dm'));

-- ON DELETE RESTRICT, not CASCADE: cascading would destroy a conversation and
-- everything it recorded the moment an account is hard deleted, which is the
-- one thing the channels design refuses to allow anywhere else. Members are
-- deactivated (team_members.is_active), not deleted, so this blocks nothing the
-- platform actually does.
ALTER TABLE public.channels
  ADD COLUMN dm_user_a UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN dm_user_b UUID REFERENCES auth.users(id) ON DELETE RESTRICT;

-- Both present on a DM, both absent otherwise, and always in id order. The
-- ordering is what makes "the DM between these two people" a single row.
ALTER TABLE public.channels
  ADD CONSTRAINT channels_dm_pair CHECK (
    (kind = 'dm'
      AND dm_user_a IS NOT NULL
      AND dm_user_b IS NOT NULL
      AND dm_user_a < dm_user_b)
    OR (kind <> 'dm' AND dm_user_a IS NULL AND dm_user_b IS NULL)
  );

-- A DM is flat: it is not a product room and nothing nests under or above it.
ALTER TABLE public.channels
  ADD CONSTRAINT channels_dm_is_flat CHECK (
    kind <> 'dm' OR (parent_id IS NULL AND NOT is_primary)
  );

-- The original binding constraint enumerated the two kinds that existed, so a
-- dm row satisfies neither branch and would be rejected outright.
ALTER TABLE public.channels
  DROP CONSTRAINT channels_product_binding;

ALTER TABLE public.channels
  ADD CONSTRAINT channels_product_binding CHECK (
    (kind = 'product' AND product_id IS NOT NULL)
    OR (kind IN ('standing', 'dm') AND product_id IS NULL)
  );

CREATE UNIQUE INDEX channels_dm_pair_key
ON public.channels (dm_user_a, dm_user_b)
WHERE kind = 'dm';

-- Listing "my DMs" hits one side or the other, and neither is the leading
-- column of the pair index for the dm_user_b case.
CREATE INDEX channels_dm_user_b_idx
ON public.channels (dm_user_b)
WHERE kind = 'dm';

-- ============================================================
-- can_read_channel — the one place the rule is written
-- ============================================================
-- SECURITY DEFINER so the check itself is not filtered by the very policy it
-- exists to implement. Deliberately NOT used inside the channels SELECT policy:
-- a policy on channels calling a function that reads channels is the kind of
-- thing that works until someone turns on FORCE ROW LEVEL SECURITY. That policy
-- states the condition inline instead.

CREATE OR REPLACE FUNCTION public.can_read_channel(p_channel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.is_active_member()
     AND EXISTS (
       SELECT 1
       FROM public.channels c
       WHERE c.id = p_channel_id
         AND (
           c.kind <> 'dm'
           OR (SELECT auth.uid()) IN (c.dm_user_a, c.dm_user_b)
         )
     );
$$;

GRANT EXECUTE ON FUNCTION public.can_read_channel(UUID) TO authenticated;

-- ============================================================
-- Visibility: five policies that used to say "any active member"
-- ============================================================

DROP POLICY "active members read channels" ON public.channels;
CREATE POLICY "active members read channels"
ON public.channels FOR SELECT TO authenticated
USING (
  public.is_active_member()
  AND (
    kind <> 'dm'
    OR (SELECT auth.uid()) IN (dm_user_a, dm_user_b)
  )
);

DROP POLICY "active members read messages" ON public.messages;
CREATE POLICY "active members read messages"
ON public.messages FOR SELECT TO authenticated
USING (public.can_read_channel(channel_id));

-- Posting into a DM you are not part of was previously allowed by the same
-- "any active member" rule. A message you cannot read is not a message you may
-- write either.
DROP POLICY "active members post their own messages" ON public.messages;
CREATE POLICY "active members post their own messages"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  public.can_read_channel(channel_id)
  AND author_id = (SELECT auth.uid())
  AND kind = 'human'
  AND promoted_to_type IS NULL
  AND deleted_at IS NULL
);

DROP POLICY "active members read channel membership" ON public.channel_members;
CREATE POLICY "active members read channel membership"
ON public.channel_members FOR SELECT TO authenticated
USING (public.can_read_channel(channel_id));

-- The gate-crash this migration exists to close: "join a channel yourself" let
-- any active member insert themselves into any channel_id they could name.
DROP POLICY "join a channel yourself" ON public.channel_members;
CREATE POLICY "join a channel yourself"
ON public.channel_members FOR INSERT TO authenticated
WITH CHECK (
  public.can_read_channel(channel_id)
  AND user_id = (SELECT auth.uid())
);

DROP POLICY "active members read mentions" ON public.message_mentions;
CREATE POLICY "active members read mentions"
ON public.message_mentions FOR SELECT TO authenticated
USING (
  public.is_active_member()
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id
      AND public.can_read_channel(m.channel_id)
  )
);

DROP POLICY "active members read proposals" ON public.agent_proposals;
CREATE POLICY "active members read proposals"
ON public.agent_proposals FOR SELECT TO authenticated
USING (public.can_read_channel(channel_id));

-- Agent activity carries the source channel id (and sometimes the source
-- message id or a scheduled prompt). Keep those secondary records behind the
-- same visibility boundary as the conversation that produced them.
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

-- Mention rows are also private-channel metadata. Dropping an outsider mention
-- here keeps participants from seeing a misleading mention record and pairs
-- with the notification guard above to prevent the message body escaping.
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

-- A DM's name and topic describe both people, and archiving one would take the
-- conversation off the other person's rail without their say. Neither is a
-- decision one participant makes alone, so the client UPDATE path excludes DMs
-- entirely.
DROP POLICY "creator or admin updates channels" ON public.channels;
CREATE POLICY "creator or admin updates channels"
ON public.channels FOR UPDATE TO authenticated
USING (
  kind <> 'dm'
  AND (public.is_admin() OR created_by = (SELECT auth.uid()))
)
WITH CHECK (
  kind <> 'dm'
  AND (public.is_admin() OR created_by = (SELECT auth.uid()))
);

-- ============================================================
-- Nothing nests under a DM
-- ============================================================
-- The channels_dm_is_flat CHECK already rejects this, but by way of a
-- constraint name. parent_id is only ever supplied by a client, so the message
-- it gets back should be a sentence.

CREATE OR REPLACE FUNCTION public.channels_inherit_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent public.channels;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO parent FROM public.channels WHERE id = NEW.parent_id;

  IF parent.id IS NULL THEN
    RAISE EXCEPTION 'parent channel not found';
  END IF;

  IF parent.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot add a channel under an archived channel';
  END IF;

  IF parent.kind = 'dm' THEN
    RAISE EXCEPTION 'a direct message cannot have subchannels';
  END IF;

  NEW.kind := parent.kind;
  NEW.product_id := parent.product_id;
  NEW.is_primary := false;

  RETURN NEW;
END;
$$;

-- ============================================================
-- remove_channel: a DM is not one person's to remove
-- ============================================================
-- Same reasoning as the UPDATE policy. Deleting an empty DM would be harmless,
-- but the rule is easier to trust when it has no exceptions, and the UI offers
-- no control for it either.

CREATE OR REPLACE FUNCTION public.remove_channel(p_channel_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  ch public.channels;
  was_deleted BOOLEAN;
BEGIN
  SELECT * INTO ch FROM public.channels WHERE id = p_channel_id;
  IF ch.id IS NULL THEN
    RAISE EXCEPTION 'channel not found';
  END IF;

  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'only active members can remove channels';
  END IF;

  IF ch.kind = 'dm' THEN
    RAISE EXCEPTION 'a direct message cannot be removed';
  END IF;

  -- Mirrors the "creator or admin updates channels" policy: removing a channel
  -- is governed by the same rule as renaming one.
  IF NOT (public.is_admin() OR ch.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'only the channel creator or an admin can remove a channel';
  END IF;

  -- A product's own room is created and maintained by products_sync_channel().
  -- Removing it would leave that trigger tending a channel that no longer
  -- exists, and the product with no room at all. It closes when the product is
  -- archived, which is the honest way for it to go.
  IF ch.is_primary THEN
    RAISE EXCEPTION 'the product primary channel cannot be removed on its own';
  END IF;

  was_deleted := public.remove_channel_node(p_channel_id);

  RETURN jsonb_build_object('deleted', was_deleted);
END;
$$;

-- ============================================================
-- open_dm — the only way a dm row is created
-- ============================================================
-- No INSERT grant exists on dm_user_a/dm_user_b, and the channels INSERT policy
-- still pins kind = 'standing', so a client cannot write one of these rows by
-- any other route.
--
-- Idempotent: opening a DM that already exists returns it. Two people clicking
-- at the same moment is a unique-violation race, which is caught and resolved
-- by re-reading rather than surfaced.

CREATE OR REPLACE FUNCTION public.open_dm(p_other_user UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  me UUID := (SELECT auth.uid());
  lo UUID;
  hi UUID;
  existing UUID;
  new_id UUID;
  my_name TEXT;
  their_name TEXT;
  their_kind TEXT;
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'only active members can open a direct message';
  END IF;

  IF p_other_user IS NULL OR p_other_user = me THEN
    RAISE EXCEPTION 'pick someone other than yourself';
  END IF;

  SELECT display_name, kind INTO their_name, their_kind
  FROM public.team_members
  WHERE user_id = p_other_user AND is_active;

  IF their_name IS NULL THEN
    RAISE EXCEPTION 'that person is not an active member';
  END IF;

  -- Agents have team_members rows too, but an agent only ever answers when its
  -- handle is mentioned (see messages_queue_agent_runs). A DM to one would be a
  -- room where nobody ever replies, so it is refused rather than offered.
  IF their_kind <> 'human' THEN
    RAISE EXCEPTION 'direct messages are between people';
  END IF;

  SELECT display_name INTO my_name
  FROM public.team_members WHERE user_id = me;

  lo := least(me, p_other_user);
  hi := greatest(me, p_other_user);

  SELECT id INTO existing FROM public.channels
  WHERE kind = 'dm' AND dm_user_a = lo AND dm_user_b = hi;

  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  BEGIN
    INSERT INTO public.channels (
      slug, name, kind, dm_user_a, dm_user_b, created_by
    )
    VALUES (
      -- The pair's own ids, so the slug is unique by construction and needs no
      -- collision handling. 16 hex characters, well inside the slug CHECK.
      'dm-' || left(replace(lo::TEXT, '-', ''), 8)
            || '-' || left(replace(hi::TEXT, '-', ''), 8),
      -- Stored for notification bodies and the audit trail. The rail shows the
      -- other participant's name instead, which is per-viewer and cannot be a
      -- stored column.
      left(coalesce(my_name, 'Someone') || ' · ' || coalesce(their_name, 'Someone'), 80),
      'dm',
      lo,
      hi,
      me
    )
    RETURNING id INTO new_id;
  EXCEPTION WHEN unique_violation THEN
    -- The other side opened it between the SELECT and the INSERT.
    SELECT id INTO new_id FROM public.channels
    WHERE kind = 'dm' AND dm_user_a = lo AND dm_user_b = hi;
    RETURN new_id;
  END;

  -- 'all', unlike the 'mentions' default a room gets: everything said in a DM
  -- is addressed to the other person by definition.
  INSERT INTO public.channel_members (channel_id, user_id, notification_level)
  VALUES (new_id, lo, 'all'), (new_id, hi, 'all')
  ON CONFLICT DO NOTHING;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_dm(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_dm(UUID) TO authenticated;
