-- Collaboration layer, part 1: channels, messages, threads, mentions.
--
-- The design constraint that shapes this file is stated in COLLABORATION.md:
-- conversation next to a system of record produces drift. Two structures push
-- back on that here, and the rest of the file is bookkeeping around them.
--
--   1. A channel can be BOUND to a product (kind='product'). A bound channel is
--      created automatically with the product, carries its id, and is where
--      domain events post themselves. That is what keeps the room and the record
--      looking at the same thing.
--   2. messages.promoted_to_* records that a message BECAME something — a task, a
--      status update, a knowledge item. The conversation keeps a pointer to what
--      it produced, so "where did this decision go" has an answer in the data
--      rather than in someone's memory.
--
-- v1 has no private channels and no DMs: every active member can read every
-- channel. Membership therefore means "I follow this", not "I may see this", and
-- read policies check is_active_member() rather than channel_members. Making
-- channels private later is a policy change on two tables, not a redesign.

-- ============================================================
-- channels
-- ============================================================

CREATE TABLE public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  name_ar TEXT CHECK (name_ar IS NULL OR char_length(btrim(name_ar)) BETWEEN 1 AND 80),
  topic TEXT CHECK (topic IS NULL OR char_length(topic) <= 500),
  kind TEXT NOT NULL DEFAULT 'standing'
    CHECK (kind IN ('standing', 'product')),
  -- UNIQUE, not just FK: one bound channel per product, enforced by the index
  -- rather than by whoever writes the insert.
  product_id UUID UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The two kinds are exactly distinguished by whether a product hangs off them.
  -- Without this a 'standing' row could carry a product_id and quietly behave as
  -- a bound channel that nothing maintains.
  CONSTRAINT channels_product_binding CHECK (
    (kind = 'product' AND product_id IS NOT NULL)
    OR (kind = 'standing' AND product_id IS NULL)
  )
);

CREATE INDEX channels_kind_idx ON public.channels (kind, slug);
CREATE INDEX channels_active_idx ON public.channels (slug) WHERE archived_at IS NULL;

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read channels"
ON public.channels FOR SELECT TO authenticated
USING (public.is_active_member());

-- Standing channels only. A bound channel is created by the product trigger, so
-- letting a client insert kind='product' would allow a second rival channel for
-- a product that already has one (the UNIQUE would catch it, but the error would
-- be a constraint violation rather than a policy answer).
CREATE POLICY "active members create standing channels"
ON public.channels FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND kind = 'standing'
  AND product_id IS NULL
  AND created_by = (SELECT auth.uid())
);

CREATE POLICY "creator or admin updates channels"
ON public.channels FOR UPDATE TO authenticated
USING (public.is_admin() OR created_by = (SELECT auth.uid()))
WITH CHECK (public.is_admin() OR created_by = (SELECT auth.uid()));

REVOKE ALL ON public.channels FROM anon, authenticated;
GRANT SELECT ON public.channels TO authenticated;
GRANT INSERT (slug, name, name_ar, topic, kind, created_by) ON public.channels TO authenticated;
-- No DELETE anywhere: archiving is the only way a channel leaves the list, so a
-- conversation cannot be destroyed along with whatever it recorded.
GRANT UPDATE (name, name_ar, topic, archived_at) ON public.channels TO authenticated;

CREATE TRIGGER channels_updated_at
BEFORE UPDATE ON public.channels
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ============================================================
-- Bound channels follow their product
-- ============================================================
-- Slug collisions are real: two products can be named similarly enough to
-- normalise to the same slug. The product's own slug is already UNIQUE, so
-- reusing it is collision-free by construction.

CREATE OR REPLACE FUNCTION public.products_sync_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.channels (slug, name, kind, product_id, created_by, archived_at)
    VALUES (
      left(NEW.slug, 48), NEW.name, 'product', NEW.id, NEW.owner_id,
      -- A product created already archived (an import) gets an archived channel
      -- rather than a live room for something nobody is working on.
      NEW.archived_at
    )
    ON CONFLICT (product_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- Renames follow. Archive state follows in both directions: un-archiving a
  -- product brings its room back rather than leaving it silently dead.
  UPDATE public.channels
  SET name = NEW.name,
      archived_at = NEW.archived_at
  WHERE product_id = NEW.id
    AND (name IS DISTINCT FROM NEW.name OR archived_at IS DISTINCT FROM NEW.archived_at);

  RETURN NEW;
END;
$$;

CREATE TRIGGER products_sync_channel_insert
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_sync_channel();

CREATE TRIGGER products_sync_channel_update
AFTER UPDATE OF name, archived_at ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_sync_channel();

-- Backfill: every product that already exists gets its room.
INSERT INTO public.channels (slug, name, kind, product_id, created_by, archived_at)
SELECT left(p.slug, 48), p.name, 'product', p.id, p.owner_id, p.archived_at
FROM public.products p
ON CONFLICT (product_id) DO NOTHING;

-- The one standing channel that has to exist for the feature to make sense on
-- first load. Everything else is created by the team.
INSERT INTO public.channels (slug, name, name_ar, kind, topic)
VALUES ('general', 'General', 'عام', 'standing', 'Everything that does not belong to one product yet.')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- channel_members
-- ============================================================
-- Follow state and read position. Not an access control list — see the header.

CREATE TABLE public.channel_members (
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'all' notifies on every message, 'mentions' only when named, 'none' stays
  -- quiet. Default 'mentions' so joining a busy room is not a punishment.
  notification_level TEXT NOT NULL DEFAULT 'mentions'
    CHECK (notification_level IN ('all', 'mentions', 'none')),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX channel_members_user_id_idx ON public.channel_members (user_id, channel_id);

ALTER TABLE public.channel_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read channel membership"
ON public.channel_members FOR SELECT TO authenticated
USING (public.is_active_member());

-- Same rule as task_watchers: you may only sign yourself up. Adding a colleague
-- to a noisy channel is not a thing one member should be able to do to another.
CREATE POLICY "join a channel yourself"
ON public.channel_members FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND user_id = (SELECT auth.uid()));

CREATE POLICY "update own channel membership"
ON public.channel_members FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "leave a channel yourself"
ON public.channel_members FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.channel_members FROM anon, authenticated;
GRANT SELECT, DELETE ON public.channel_members TO authenticated;
GRANT INSERT (channel_id, user_id, notification_level) ON public.channel_members TO authenticated;
GRANT UPDATE (notification_level, last_read_at) ON public.channel_members TO authenticated;

-- ============================================================
-- messages
-- ============================================================

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  -- One level of threading, enforced by trigger below. Slack's model, and the
  -- reason it stays readable: a reply to a reply would make the stream a tree
  -- nobody can render in a narrow column.
  parent_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
  -- 'system' is the domain event feed (a phase completed, health changed);
  -- 'agent' is written only by the edge function holding the service key.
  kind TEXT NOT NULL DEFAULT 'human'
    CHECK (kind IN ('human', 'agent', 'system')),
  -- What this message became. Deliberately un-constrained by FK: the target
  -- lives in one of several tables, and a pointer that survives the target's
  -- deletion is more useful here than referential rigour — the message text
  -- still reads correctly either way.
  promoted_to_type TEXT CHECK (
    promoted_to_type IS NULL OR promoted_to_type IN
    ('status_update', 'product_task', 'knowledge_item', 'lifecycle_phase')
  ),
  promoted_to_id UUID,
  edited_at TIMESTAMPTZ,
  -- Soft delete: the row stays so replies beneath it keep their parent and the
  -- audit of who said what survives. The UI renders a tombstone.
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT messages_promotion_complete CHECK (
    num_nonnulls(promoted_to_type, promoted_to_id) IN (0, 2)
  )
);

CREATE INDEX messages_channel_idx
ON public.messages (channel_id, created_at DESC)
WHERE parent_id IS NULL;

CREATE INDEX messages_thread_idx
ON public.messages (parent_id, created_at)
WHERE parent_id IS NOT NULL;

CREATE INDEX messages_author_idx ON public.messages (author_id, created_at DESC);

-- Threads are one level deep, and a reply cannot escape its parent's channel.
CREATE OR REPLACE FUNCTION public.validate_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent public.messages;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.messages WHERE id = NEW.parent_id;

    IF parent.id IS NULL THEN
      RAISE EXCEPTION 'parent message does not exist';
    END IF;

    IF parent.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'threads are one level deep; reply to the top message instead';
    END IF;

    IF parent.channel_id <> NEW.channel_id THEN
      RAISE EXCEPTION 'a reply must stay in its parent channel';
    END IF;
  END IF;

  -- Posting into an archived channel would produce a conversation nobody sees.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.channels WHERE id = NEW.channel_id AND archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'channel is archived';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_validate
BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.validate_message();

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read messages"
ON public.messages FOR SELECT TO authenticated
USING (public.is_active_member());

-- kind='human' is pinned here, which is the whole point: a member cannot forge a
-- message attributed to an agent or to the system. Those two kinds are written
-- exclusively by the edge function through the admin client, which does not pass
-- through RLS at all.
CREATE POLICY "active members post their own messages"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND author_id = (SELECT auth.uid())
  AND kind = 'human'
  AND promoted_to_type IS NULL
  AND deleted_at IS NULL
);

CREATE POLICY "author edits own message"
ON public.messages FOR UPDATE TO authenticated
USING (author_id = (SELECT auth.uid()) AND kind = 'human')
WITH CHECK (author_id = (SELECT auth.uid()) AND kind = 'human');

REVOKE ALL ON public.messages FROM anon, authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT INSERT (channel_id, parent_id, author_id, body, kind) ON public.messages TO authenticated;
-- promoted_to_* is absent on purpose: only decide_agent_proposal and the
-- promotion RPC set it, so a client cannot claim a message produced a task it
-- never produced. No DELETE grant — deleted_at is the only removal path.
GRANT UPDATE (body, edited_at, deleted_at) ON public.messages TO authenticated;

-- ============================================================
-- message_mentions
-- ============================================================
-- Extracted server-side from the body at insert time rather than trusted from
-- the client: a client-supplied mention list could name someone the body never
-- mentions, which is how you build a spam vector into your own notifications.

CREATE TABLE public.message_mentions (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, mentioned_user_id)
);

CREATE INDEX message_mentions_user_idx
ON public.message_mentions (mentioned_user_id, created_at DESC);

ALTER TABLE public.message_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read mentions"
ON public.message_mentions FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.message_mentions FROM anon, authenticated;
GRANT SELECT ON public.message_mentions TO authenticated;

-- ============================================================
-- notifications: chat types
-- ============================================================
-- The existing CHECK listed only the five task_* types. Chat adds three, and the
-- table needs to point at a message and a channel the way it already points at a
-- task and a product.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      'task_assigned', 'task_unassigned', 'task_updated',
      'task_completed', 'task_reopened',
      'mention', 'channel_message', 'proposal_pending', 'proposal_decided'
    )
  );

ALTER TABLE public.notifications
  ADD COLUMN message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  ADD COLUMN channel_id UUID REFERENCES public.channels(id) ON DELETE CASCADE;

-- ============================================================
-- team_members.kind
-- ============================================================
-- Agents are real auth.users rows with real team_members rows, which is what
-- lets notifications.actor_id, status_updates.author_id and
-- phase_transitions.actor_id keep working with no changes anywhere. The column
-- lives here rather than with the rest of the agent tables because its first
-- consumer is the mention fan-out below: without it, an agent's display name
-- would match the human mention path and file a notification for an account
-- that has no inbox.
--
-- The existing INSERT grant is column-scoped to (user_id, display_name), so
-- self-registration cannot set this. Provisioning an agent is an admin action.

ALTER TABLE public.team_members
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'
    CHECK (kind IN ('human', 'agent'));

CREATE INDEX team_members_kind_idx ON public.team_members (kind) WHERE kind = 'agent';

-- ============================================================
-- Mention extraction and fan-out
-- ============================================================
-- One trigger does both jobs, because they are the same scan of the same string
-- and doing them apart would mean parsing the body twice.
--
-- Handles are matched against team_members.display_name normalised to a handle
-- (lowercase, spaces stripped) and, once part 2 lands, against agents.handle.
-- Matching is deliberately exact: a fuzzy match that notifies the wrong person
-- is worse than a mention that silently does not fire.

CREATE OR REPLACE FUNCTION public.messages_fan_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_handle TEXT;
  target UUID;
  channel_name TEXT;
  author_name TEXT;
  follower RECORD;
BEGIN
  IF NEW.kind = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO channel_name FROM public.channels WHERE id = NEW.channel_id;
  SELECT display_name INTO author_name FROM public.team_members WHERE user_id = NEW.author_id;

  -- @handle tokens in the body.
  FOR v_handle IN
    SELECT DISTINCT lower(m[1])
    FROM regexp_matches(NEW.body, '@([A-Za-z0-9._-]{2,40})', 'g') AS m
  LOOP
    -- kind='human' matters: an agent also has a team_members row, and without
    -- this @warden would match here as well as in messages_queue_agent_runs(),
    -- filing a notification for an account that has no inbox and never reads
    -- one. Agent mentions are routed by handle in part 2, not by display name.
    SELECT tm.user_id INTO target
    FROM public.team_members tm
    WHERE tm.is_active
      AND tm.kind = 'human'
      AND lower(replace(tm.display_name, ' ', '')) = v_handle
    LIMIT 1;

    IF target IS NULL OR target = NEW.author_id THEN
      CONTINUE;
    END IF;

    INSERT INTO public.message_mentions (message_id, mentioned_user_id)
    VALUES (NEW.id, target)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.notifications (
      user_id, type, message_id, channel_id, actor_id, title, body
    )
    VALUES (
      target, 'mention', NEW.id, NEW.channel_id, NEW.author_id,
      coalesce(author_name, 'Someone') || ' mentioned you in #' || coalesce(channel_name, 'a channel'),
      left(NEW.body, 2000)
    );
  END LOOP;

  -- Followers on notification_level='all' who were not already mentioned above.
  FOR follower IN
    SELECT cm.user_id
    FROM public.channel_members cm
    WHERE cm.channel_id = NEW.channel_id
      AND cm.notification_level = 'all'
      AND cm.user_id <> NEW.author_id
      AND NOT EXISTS (
        SELECT 1 FROM public.message_mentions mm
        WHERE mm.message_id = NEW.id AND mm.mentioned_user_id = cm.user_id
      )
  LOOP
    INSERT INTO public.notifications (
      user_id, type, message_id, channel_id, actor_id, title, body
    )
    VALUES (
      follower.user_id, 'channel_message', NEW.id, NEW.channel_id, NEW.author_id,
      'New message in #' || coalesce(channel_name, 'a channel'),
      left(NEW.body, 2000)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_fan_out
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_fan_out();

-- ============================================================
-- Domain event feed into bound channels
-- ============================================================
-- This is the counterweight to drift: the record posts itself into the room.
-- kind='system' messages carry no author and are excluded from mention fan-out.

CREATE OR REPLACE FUNCTION public.post_product_event(
  p_product_id UUID,
  p_body TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_channel UUID;
BEGIN
  SELECT id INTO target_channel
  FROM public.channels
  WHERE product_id = p_product_id AND archived_at IS NULL;

  IF target_channel IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.messages (channel_id, author_id, body, kind)
  VALUES (target_channel, NULL, p_body, 'system');
END;
$$;

-- Status updates announce themselves.
CREATE OR REPLACE FUNCTION public.status_updates_announce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.post_product_event(
    NEW.product_id,
    'Status update — health **' || NEW.health || '**'
      || coalesce(', stage **' || NEW.stage || '**', '')
      || E'\n\n' || NEW.summary
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER status_updates_announce
AFTER INSERT ON public.status_updates
FOR EACH ROW EXECUTE FUNCTION public.status_updates_announce();

-- Lifecycle transitions announce themselves. phase_transitions carries
-- product_id directly, so no join back through the phase row is needed.
CREATE OR REPLACE FUNCTION public.phase_transitions_announce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.post_product_event(
    NEW.product_id,
    'Lifecycle — **' || NEW.phase || '** → **' || NEW.to_state || '**'
      || CASE WHEN NEW.waiver_reason IS NOT NULL
              THEN E'\n\nWaived: ' || NEW.waiver_reason
              ELSE '' END
      || CASE WHEN cardinality(NEW.missing_artifacts) > 0
              THEN E'\n\nMissing: ' || array_to_string(NEW.missing_artifacts, ', ')
              ELSE '' END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase_transitions_announce
AFTER INSERT ON public.phase_transitions
FOR EACH ROW EXECUTE FUNCTION public.phase_transitions_announce();

-- Releases announce their transitions too. release_transitions also carries
-- product_id directly; its state column is to_status, not to_state.
CREATE OR REPLACE FUNCTION public.release_transitions_announce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  ver TEXT;
BEGIN
  SELECT r.version INTO ver
  FROM public.product_releases r
  WHERE r.id = NEW.release_id;

  PERFORM public.post_product_event(
    NEW.product_id,
    'Release **' || coalesce(ver, '?') || '** — ' || NEW.to_status
      || CASE WHEN NEW.waiver_reason IS NOT NULL
              THEN E'\n\nWaived: ' || NEW.waiver_reason
              ELSE '' END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER release_transitions_announce
AFTER INSERT ON public.release_transitions
FOR EACH ROW EXECUTE FUNCTION public.release_transitions_announce();
