-- Task notifications: assignment, updates, and a way to follow work you do not
-- own.
--
-- Three tables and one trigger:
--   task_watchers            who has asked to hear about a task
--   notification_preferences whether a person also wants it by email
--   notifications            the delivered items, one row per recipient
--
-- The trigger is the only writer of notifications. Doing this in the database
-- rather than in the server actions means a task changed from anywhere — a
-- future edge function, a manual SQL fix, a second client — still notifies the
-- people watching it. A notification you only get when the UI remembers to send
-- it is not a notification system.
--
-- Email is opt-in and never blocks. The trigger only marks a row 'pending';
-- the notify-email edge function drains those rows out of band, so a mail
-- outage cannot fail a task update.

-- ============================================================
-- notification_preferences
-- ============================================================
-- A missing row means the defaults below: in-app yes, email no. Nobody gets
-- email until they ask for it.

CREATE TABLE public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  email_on_assign BOOLEAN NOT NULL DEFAULT true,
  email_on_update BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER notification_preferences_updated_at
BEFORE UPDATE ON public.notification_preferences
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notification preferences read"
ON public.notification_preferences FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "own notification preferences insert"
ON public.notification_preferences FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member() AND user_id = (SELECT auth.uid())
);

CREATE POLICY "own notification preferences update"
ON public.notification_preferences FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.notification_preferences FROM anon, authenticated;
GRANT SELECT, INSERT ON public.notification_preferences TO authenticated;
GRANT UPDATE (email_enabled, email_on_assign, email_on_update)
ON public.notification_preferences TO authenticated;

-- ============================================================
-- task_watchers
-- ============================================================
-- "I can monitor it and get notification once it is updated." Watching is
-- public within the team: seeing who else is following a task is useful, and
-- there is nothing sensitive in the fact itself.

CREATE TABLE public.task_watchers (
  task_id UUID NOT NULL
    REFERENCES public.product_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX task_watchers_user_id_idx
ON public.task_watchers (user_id, created_at DESC);

ALTER TABLE public.task_watchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read task watchers"
ON public.task_watchers FOR SELECT TO authenticated
USING (public.is_active_member());

-- You may only add or remove yourself. Signing someone else up for mail is not
-- a thing one colleague should be able to do to another.
CREATE POLICY "watch a task yourself"
ON public.task_watchers FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member() AND user_id = (SELECT auth.uid())
);

CREATE POLICY "unwatch a task yourself"
ON public.task_watchers FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.task_watchers FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.task_watchers TO authenticated;

-- ============================================================
-- notifications
-- ============================================================

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'task_assigned', 'task_unassigned', 'task_updated',
      'task_completed', 'task_reopened'
    )
  ),
  task_id UUID REFERENCES public.product_tasks(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The task title and the changed field, captured at the moment it happened.
  -- Denormalised on purpose: a notification should still read correctly after
  -- the task has been renamed again, and it must survive the task's deletion
  -- long enough to be read. (The FK is ON DELETE CASCADE, so a deleted task
  -- does clear its notifications — the alternative is a bell full of links to
  -- nothing.)
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  body TEXT CHECK (body IS NULL OR char_length(body) <= 2000),
  read_at TIMESTAMPTZ,
  email_state TEXT NOT NULL DEFAULT 'skipped'
    CHECK (email_state IN ('skipped', 'pending', 'sent', 'failed')),
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_id_idx
ON public.notifications (user_id, created_at DESC);

CREATE INDEX notifications_unread_idx
ON public.notifications (user_id, created_at DESC)
WHERE read_at IS NULL;

-- The drain queue for notify-email. Partial, so it stays tiny however many
-- notifications accumulate.
CREATE INDEX notifications_email_pending_idx
ON public.notifications (created_at)
WHERE email_state = 'pending';

CREATE INDEX notifications_task_id_idx
ON public.notifications (task_id)
WHERE task_id IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Strictly your own: not "active members", not admins. A notification is
-- addressed mail.
CREATE POLICY "read own notifications"
ON public.notifications FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "mark own notifications read"
ON public.notifications FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "dismiss own notifications"
ON public.notifications FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

-- No INSERT to any client role: the trigger is the sole author, so a
-- notification always reflects something that actually happened. The UPDATE
-- grant is read_at alone — a recipient cannot rewrite the message, and cannot
-- touch email_state to make the drain re-send.
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- ============================================================
-- Fan-out
-- ============================================================

CREATE OR REPLACE FUNCTION public.enqueue_task_notification(
  p_task_id UUID,
  p_product_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_actor UUID,
  -- true  → the assignee only (an assignment is addressed to one person)
  -- false → everyone watching the task
  p_assignee_only BOOLEAN,
  p_assignee UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  inserted INTEGER;
BEGIN
  WITH candidates AS (
    SELECT p_assignee AS user_id WHERE p_assignee_only AND p_assignee IS NOT NULL
    UNION
    SELECT w.user_id FROM public.task_watchers w
    WHERE NOT p_assignee_only AND w.task_id = p_task_id
  ),
  recipients AS (
    SELECT DISTINCT c.user_id
    FROM candidates c
    JOIN public.team_members tm
      ON tm.user_id = c.user_id AND tm.is_active
    -- You never get told about your own action.
    WHERE p_actor IS NULL OR c.user_id <> p_actor
  )
  INSERT INTO public.notifications (
    user_id, type, task_id, product_id, actor_id, title, body, email_state
  )
  SELECT
    r.user_id, p_type, p_task_id, p_product_id, p_actor, p_title, p_body,
    CASE
      WHEN coalesce(np.email_enabled, false) AND CASE
        WHEN p_type = 'task_assigned' THEN coalesce(np.email_on_assign, true)
        ELSE coalesce(np.email_on_update, true)
      END THEN 'pending'
      ELSE 'skipped'
    END
  FROM recipients r
  LEFT JOIN public.notification_preferences np ON np.user_id = r.user_id;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default. This one is
-- SECURITY DEFINER and writes rows that clients are otherwise forbidden to
-- insert, so leaving that default would hand every signed-in user the ability
-- to forge a notification from anyone about anything. It is called only from
-- the trigger below, which runs as the definer regardless of the caller.
REVOKE ALL ON FUNCTION public.enqueue_task_notification(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, UUID
) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- The trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.product_tasks_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  actor_name TEXT;
  prod_name TEXT;
  changed TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT display_name INTO actor_name
  FROM public.team_members WHERE user_id = actor;
  actor_name := coalesce(actor_name, 'Someone');

  SELECT name INTO prod_name FROM public.products WHERE id = NEW.product_id;

  IF TG_OP = 'INSERT' THEN
    -- The author and the assignee follow the task from the start; either can
    -- unwatch. Everyone else opts in.
    INSERT INTO public.task_watchers (task_id, user_id)
    SELECT NEW.id, u
    FROM unnest(ARRAY[NEW.created_by, NEW.assignee_id]) AS u
    WHERE u IS NOT NULL
    ON CONFLICT DO NOTHING;

    IF NEW.assignee_id IS NOT NULL THEN
      PERFORM public.enqueue_task_notification(
        NEW.id, NEW.product_id, 'task_assigned',
        NEW.title,
        actor_name || ' assigned you a task on ' || coalesce(prod_name, 'a product'),
        actor, true, NEW.assignee_id
      );
    END IF;

    RETURN NEW;
  END IF;

  -- Reassignment: tell the new owner, and start them watching.
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF NEW.assignee_id IS NOT NULL THEN
      INSERT INTO public.task_watchers (task_id, user_id)
      VALUES (NEW.id, NEW.assignee_id)
      ON CONFLICT DO NOTHING;

      PERFORM public.enqueue_task_notification(
        NEW.id, NEW.product_id, 'task_assigned',
        NEW.title,
        actor_name || ' assigned you a task on ' || coalesce(prod_name, 'a product'),
        actor, true, NEW.assignee_id
      );
    END IF;

    -- The person who lost it is told too. They keep their watcher row, so they
    -- still see the task land; unwatching is how you stop hearing about it.
    IF OLD.assignee_id IS NOT NULL THEN
      PERFORM public.enqueue_task_notification(
        NEW.id, NEW.product_id, 'task_unassigned',
        NEW.title,
        actor_name || ' reassigned this task',
        actor, true, OLD.assignee_id
      );
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.enqueue_task_notification(
      NEW.id, NEW.product_id,
      CASE WHEN NEW.status = 'completed' THEN 'task_completed' ELSE 'task_reopened' END,
      NEW.title,
      actor_name || CASE
        WHEN NEW.status = 'completed' THEN ' completed this task'
        ELSE ' reopened this task'
      END,
      actor, false, NULL
    );
  END IF;

  -- Content edits collapse into one notification naming what moved, rather
  -- than three saying "something changed".
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    changed := changed || 'title';
  END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    changed := changed || 'notes';
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    changed := changed || 'due date';
  END IF;
  IF NEW.release_id IS DISTINCT FROM OLD.release_id THEN
    changed := changed || 'release';
  END IF;

  IF cardinality(changed) > 0 THEN
    PERFORM public.enqueue_task_notification(
      NEW.id, NEW.product_id, 'task_updated',
      NEW.title,
      actor_name || ' updated the ' || array_to_string(changed, ', '),
      actor, false, NULL
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_tasks_notify
AFTER INSERT OR UPDATE ON public.product_tasks
FOR EACH ROW EXECUTE FUNCTION public.product_tasks_notify();

-- ============================================================
-- Backfill watchers for existing tasks
-- ============================================================
-- Without this, every task that predates this migration would be silent until
-- somebody edited it.

INSERT INTO public.task_watchers (task_id, user_id)
SELECT t.id, u
FROM public.product_tasks t
CROSS JOIN LATERAL unnest(ARRAY[t.created_by, t.assignee_id]) AS u
WHERE u IS NOT NULL
  AND t.status <> 'completed'
ON CONFLICT DO NOTHING;
