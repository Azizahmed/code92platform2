-- General tasks, and the lifecycle phase a task belongs to.
--
-- Two changes to product_tasks, both driven by the same request: tasks should be
-- creatable and manageable from the All Tasks view, not only from inside a
-- product.
--
--   1. product_id becomes nullable. A task with no product is a general task —
--      operational work that belongs to the team rather than to any one product.
--   2. lifecycle_phase records which delivery phase a task sits in, so the work
--      on a product can be read against the phase it is meant to serve.
--
-- A phase is only meaningful with a product: product_lifecycle_phases is keyed
-- by (product, cycle, phase), so a phase on a general task would name a row that
-- does not exist. The pairing is enforced below rather than left to the UI.
--
-- Dropping the NOT NULL also changes the meaning of every product comparison in
-- validate_product_task(). Those were written with `<>`, which yields NULL — not
-- false — the moment either side is NULL, and a NULL is not an exception. A
-- general task could then have joined another product's release, or parented
-- onto another product's task. Every one of them is rewritten to
-- IS DISTINCT FROM below. This is the real reason the trigger is restated in
-- full here rather than patched.

-- ============================================================
-- product_tasks.product_id — now optional
-- ============================================================

ALTER TABLE public.product_tasks
  ALTER COLUMN product_id DROP NOT NULL;

-- The existing product_tasks_product_id_idx leads with product_id, so it cannot
-- answer "every general task" — NULLs are stored but the planner has no narrow
-- path to them. The All Tasks view asks exactly that question.
CREATE INDEX product_tasks_general_idx
ON public.product_tasks (status, due_date)
WHERE product_id IS NULL;

-- ============================================================
-- product_tasks.lifecycle_phase
-- ============================================================
-- The phase name, not a product_lifecycle_phases id: a task belongs to the
-- Deploy phase of its product, not to one particular pass through Deploy. The
-- row for a phase is found by (product_id, phase) when it is needed.

ALTER TABLE public.product_tasks
  ADD COLUMN lifecycle_phase TEXT;

-- lifecycle_phase_index() is the authoritative vocabulary and is IMMUTABLE, so
-- the CHECK can call it and there is no second list to keep in step. It returns
-- NULL for a name it does not know, and `NULL IS NOT NULL` is false, so an
-- unknown phase is rejected rather than passing on a NULL result.
ALTER TABLE public.product_tasks
  ADD CONSTRAINT product_tasks_lifecycle_phase_known
    CHECK (
      lifecycle_phase IS NULL
      OR public.lifecycle_phase_index(lifecycle_phase) IS NOT NULL
    );

ALTER TABLE public.product_tasks
  ADD CONSTRAINT product_tasks_lifecycle_phase_needs_product
    CHECK (lifecycle_phase IS NULL OR product_id IS NOT NULL);

CREATE INDEX product_tasks_lifecycle_phase_idx
ON public.product_tasks (product_id, lifecycle_phase, status)
WHERE lifecycle_phase IS NOT NULL;

-- ============================================================
-- Grants
-- ============================================================
-- product_id joins the writable set only so a general task can be adopted into
-- a product later. The trigger below is what makes that safe; the grant on its
-- own would allow a task to be dragged between products, taking its release
-- scope and subtasks somewhere they do not belong.

GRANT UPDATE (lifecycle_phase, product_id)
ON public.product_tasks TO authenticated;

-- ============================================================
-- validate_product_task — NULL-safe, plus the adoption rule
-- ============================================================

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
  child_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'task parent and creator are immutable';
    END IF;

    -- One direction only: a general task may be adopted into a product, and
    -- nothing else moves. Moving a task that already belongs to a product would
    -- strand its release scope and its subtasks under the old product, and
    -- "which product was this filed under" would stop being answerable from the
    -- row itself.
    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      IF OLD.product_id IS NOT NULL OR NEW.product_id IS NULL THEN
        RAISE EXCEPTION 'a task cannot be moved between products';
      END IF;

      -- A subtask follows its parent. Adopting one on its own would break the
      -- same-product rule enforced a few lines down.
      IF OLD.parent_task_id IS NOT NULL THEN
        RAISE EXCEPTION 'move the parent task instead of the subtask';
      END IF;

      SELECT count(*) INTO child_count
      FROM public.product_tasks WHERE parent_task_id = NEW.id;

      IF child_count > 0 THEN
        RAISE EXCEPTION 'detach the subtasks before moving this task';
      END IF;

      -- Unreachable for rows written after this migration, since a general task
      -- cannot hold a release. Kept because it costs nothing and the release
      -- column predates the rule.
      IF OLD.release_id IS NOT NULL THEN
        RAISE EXCEPTION 'unscope the task from its release before moving it';
      END IF;
    END IF;
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
    -- IS DISTINCT FROM, not <>: with NULLs on either side `<>` is NULL, which
    -- raises nothing, and a general subtask would attach to a product task.
    IF parent_product_id IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'parent task must belong to the same product';
    END IF;
    IF grandparent_id IS NOT NULL THEN
      RAISE EXCEPTION 'tasks support one subtask level only';
    END IF;
  END IF;

  IF NEW.release_id IS NOT NULL THEN
    -- Stated before the lookup: a release belongs to a product, so a task with
    -- no product has no release it could legitimately be in.
    IF NEW.product_id IS NULL THEN
      RAISE EXCEPTION 'a general task cannot join a release';
    END IF;

    SELECT product_id INTO release_product_id
    FROM public.product_releases WHERE id = NEW.release_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'release not found';
    END IF;
    IF release_product_id IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'a task can only join a release of its own product';
    END IF;
  END IF;

  IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status = 'pending' THEN
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- product_tasks_notify — say "a task", not "a task on a product"
-- ============================================================
-- coalesce(prod_name, 'a product') was correct while every task had one. A
-- general task now reaches this path, and telling someone it was assigned "on a
-- product" would be a plain untruth in their inbox.

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
  on_product TEXT;
  changed TEXT[] := ARRAY[]::TEXT[];
  status_body TEXT;
BEGIN
  SELECT display_name INTO actor_name
  FROM public.team_members WHERE user_id = actor;
  actor_name := coalesce(actor_name, 'Someone');

  IF NEW.product_id IS NOT NULL THEN
    SELECT name INTO prod_name FROM public.products WHERE id = NEW.product_id;
  END IF;
  on_product := CASE WHEN prod_name IS NULL THEN '' ELSE ' on ' || prod_name END;

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
        actor_name || ' assigned you a task' || on_product,
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
        actor_name || ' assigned you a task' || on_product,
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
  IF NEW.lifecycle_phase IS DISTINCT FROM OLD.lifecycle_phase THEN
    changed := array_append(changed, 'lifecycle phase');
  END IF;
  IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    changed := array_append(changed, 'product');
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
