-- Completion notes: what was actually done, captured at the moment it is done.
--
-- A task going from pending to completed is the one moment somebody has the
-- whole thing in their head. A week later "fixed the export bug" is all that
-- survives, and the next person hits the same problem. So completing a task now
-- asks what was done, and the answer sits on the task where the question gets
-- asked again.
--
-- The note is written by the client (it is prose, and only the person who did
-- the work can write it). `completed_by` is NOT: the trigger fills it from
-- auth.uid(), so "who finished this" cannot be claimed on someone else's behalf.

ALTER TABLE public.product_tasks
  ADD COLUMN completion_note TEXT
    CHECK (completion_note IS NULL OR char_length(completion_note) <= 5000),
  ADD COLUMN completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- completion_note joins the existing column-scoped UPDATE grant.
-- completed_by deliberately does not.
GRANT UPDATE (completion_note) ON public.product_tasks TO authenticated;

-- ============================================================
-- validate_product_task — stamp who completed it
-- ============================================================
-- Reopening clears completed_at and completed_by, because neither is true any
-- more. It deliberately KEEPS completion_note: someone wrote that, and throwing
-- away writing because a task bounced back is how people learn not to write it.
-- The note is only ever shown against a completed task, and completing again
-- overwrites it.

CREATE OR REPLACE FUNCTION public.validate_product_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_product_id UUID;
  grandparent_id UUID;
  release_product_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'task product, parent, and creator are immutable';
  END IF;

  IF NEW.parent_task_id IS NOT NULL THEN
    IF NEW.parent_task_id = NEW.id THEN
      RAISE EXCEPTION 'a task cannot be its own parent';
    END IF;

    SELECT product_id, parent_task_id
      INTO parent_product_id, grandparent_id
    FROM public.product_tasks
    WHERE id = NEW.parent_task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent task not found';
    END IF;
    IF parent_product_id <> NEW.product_id THEN
      RAISE EXCEPTION 'parent task must belong to the same product';
    END IF;
    IF grandparent_id IS NOT NULL THEN
      RAISE EXCEPTION 'tasks support one subtask level only';
    END IF;
  END IF;

  IF NEW.release_id IS NOT NULL THEN
    SELECT product_id INTO release_product_id
    FROM public.product_releases WHERE id = NEW.release_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'release not found';
    END IF;
    IF release_product_id <> NEW.product_id THEN
      RAISE EXCEPTION 'a task can only join a release of its own product';
    END IF;
  END IF;

  NEW.completion_note := nullif(btrim(coalesce(NEW.completion_note, '')), '');

  IF NEW.status = 'completed' THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
    -- Stamped on the transition, not on every later edit of a completed task.
    IF TG_OP = 'INSERT' OR OLD.status <> 'completed' THEN
      NEW.completed_by := (SELECT auth.uid());
    END IF;
  ELSIF NEW.status = 'pending' THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- product_tasks_notify — carry the note into the notification
-- ============================================================
-- "X completed this task" tells a watcher something happened. The first line of
-- what was done tells them whether they need to look.

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
  status_body TEXT;
BEGIN
  SELECT display_name INTO actor_name
  FROM public.team_members WHERE user_id = actor;
  actor_name := coalesce(actor_name, 'Someone');

  SELECT name INTO prod_name FROM public.products WHERE id = NEW.product_id;

  IF TG_OP = 'INSERT' THEN
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
    IF NEW.status = 'completed' THEN
      status_body := actor_name || ' completed this task';
      IF NEW.completion_note IS NOT NULL THEN
        -- Trimmed: the notification is a summary, and the whole note is one
        -- click away on the task itself.
        status_body := status_body || ': ' || left(NEW.completion_note, 300);
      END IF;
    ELSE
      status_body := actor_name || ' reopened this task';
    END IF;

    PERFORM public.enqueue_task_notification(
      NEW.id, NEW.product_id,
      CASE WHEN NEW.status = 'completed' THEN 'task_completed' ELSE 'task_reopened' END,
      NEW.title, status_body, actor, false, NULL
    );
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title THEN
    changed := array_append(changed, 'title');
  END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    changed := array_append(changed, 'notes');
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    changed := array_append(changed, 'due date');
  END IF;
  IF NEW.release_id IS DISTINCT FROM OLD.release_id THEN
    changed := array_append(changed, 'release');
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

-- Backfill completed_by for tasks finished before this migration: the best
-- available answer is the assignee, then the author. Left NULL when neither
-- exists rather than guessed — the UI reads NULL as "not recorded", which is
-- the truth for everything that predates the column.
UPDATE public.product_tasks
SET completed_by = coalesce(assignee_id, created_by)
WHERE status = 'completed' AND completed_by IS NULL;
