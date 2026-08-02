-- Fix: editing a task raised "malformed array literal".
--
-- product_tasks_notify() built its list of changed fields with
--
--   changed := changed || 'title';
--
-- With an untyped literal on the right, Postgres resolves `||` to the
-- array || array form and tries to parse 'title' as an array literal, which
-- fails at runtime — so ANY edit to a task's title, notes, due date or release
-- aborted the whole UPDATE. Reassignment and completion were unaffected,
-- because they take a different branch.
--
-- array_append() has one meaning and cannot be resolved into the wrong
-- operator, which is why it is used here rather than a cast.

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
