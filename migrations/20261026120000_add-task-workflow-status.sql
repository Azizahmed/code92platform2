-- Release 0.2 — My work: a four-column status for the personal kanban.
--
-- workflow_status (todo | in_progress | blocked | done) is added NEXT TO the
-- existing two-state status rather than replacing it. Every existing screen,
-- server action, MCP tool and agent proposal reads and writes
-- status = pending | completed; replacing it would have meant touching all of
-- them in one release, which the 0.2 scope rule forbids. Instead the trigger
-- keeps the two in step in both directions:
--
--   workflow_status -> done          => status = completed (completed_at set)
--   workflow_status done -> other    => status = pending   (completed_at cleared)
--   status -> completed (old paths)  => workflow_status = done
--   status -> pending while done     => workflow_status = todo
--
-- So moving a card to Done on My work completes the task in its product
-- record, and completing it anywhere else moves the card.
--
-- Tasks created elsewhere get the column default, todo.
--
-- product_tasks has column-scoped UPDATE grants (see README: a table-level
-- grant would extend to this column silently); workflow_status joins them
-- explicitly.

ALTER TABLE public.product_tasks
  ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'todo'
    CHECK (workflow_status IN ('todo', 'in_progress', 'blocked', 'done'));

-- Backfill with the row triggers off: this is a derived column catching up,
-- not an edit. Left on, it would bump updated_at on every completed task and
-- run the notification trigger over all of them.
ALTER TABLE public.product_tasks DISABLE TRIGGER USER;

UPDATE public.product_tasks
SET workflow_status = 'done'
WHERE status = 'completed';

ALTER TABLE public.product_tasks ENABLE TRIGGER USER;

GRANT UPDATE (workflow_status) ON public.product_tasks TO authenticated;

-- ============================================================
-- validate_product_task — restated from 20260825097000 with the sync added
-- ============================================================
-- Everything above the sync block is unchanged from add-general-tasks.

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

  -- Keep status (the completion truth every existing screen reads and writes)
  -- and workflow_status (the My work kanban column) consistent. Whichever one
  -- the statement changed wins; on INSERT a completed status forces done.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' OR NEW.workflow_status = 'done' THEN
      NEW.status := 'completed';
      NEW.workflow_status := 'done';
    END IF;
  ELSIF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    NEW.status := CASE WHEN NEW.workflow_status = 'done'
                       THEN 'completed' ELSE 'pending' END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'completed' THEN
      NEW.workflow_status := 'done';
    ELSIF NEW.workflow_status = 'done' THEN
      NEW.workflow_status := 'todo';
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
