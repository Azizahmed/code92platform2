-- Release 0.3 — Projects: a consultation is a project.
--
-- A consultation deal won in Sales opens a project in Kickoff, on the same
-- account, owned by the deal's owner. A project is a paid engagement that is
-- delivered and then closed. It is never a product. An idea that comes out of a
-- project is captured as a product at business stage Idea, with a two-way link.
-- Nothing happens automatically: the team decides which ideas are worth a record.
--
-- engagements (0.2) becomes projects. It is renamed rather than replaced, because
-- it already holds the consultation win, and that row is where a project's
-- origin lives.

-- ============================================================
-- engagements → projects
-- ============================================================

ALTER TABLE public.engagements RENAME TO projects;
ALTER POLICY "active members read engagements" ON public.projects
  RENAME TO "active members read projects";
ALTER POLICY "active members update engagements" ON public.projects
  RENAME TO "active members update projects";
ALTER TRIGGER engagements_updated_at ON public.projects RENAME TO projects_updated_at;
ALTER INDEX public.engagements_account_id_idx RENAME TO projects_account_id_idx;

ALTER TABLE public.projects
  ADD COLUMN owner_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN start_date DATE NOT NULL DEFAULT public.business_today(),
  ADD COLUMN target_end_date DATE,
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'kickoff'
    CHECK (phase IN ('kickoff', 'discovery', 'delivery', 'handover', 'closed')),
  ADD COLUMN outcome_note TEXT
    CHECK (outcome_note IS NULL OR char_length(outcome_note) <= 5000),
  ADD COLUMN closed_at TIMESTAMPTZ,
  ADD CONSTRAINT projects_closed_complete CHECK (
    (phase = 'closed') = (closed_at IS NOT NULL)
    AND (phase <> 'closed' OR btrim(coalesce(outcome_note, '')) <> '')
  ),
  ADD CONSTRAINT projects_dates_in_order CHECK (
    target_end_date IS NULL OR target_end_date >= start_date
  );

-- Existing consultation wins (none in production yet, but the rule holds for any
-- that appear before this migration runs) take the deal's owner and creator.
UPDATE public.projects p
SET owner_id = d.owner_id,
    created_by = d.created_by
FROM public.deals d
WHERE d.id = p.deal_id;

ALTER TABLE public.projects ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX projects_owner_id_idx ON public.projects (owner_id, phase);
CREATE INDEX projects_phase_idx ON public.projects (phase);

-- Column grants. phase and closed_at have none: only move_project_phase() writes
-- them, so a close always carries an outcome note and a log row.
GRANT INSERT (account_id, name, owner_id, start_date, target_end_date, ownership,
              notes, created_by)
ON public.projects TO authenticated;
GRANT UPDATE (owner_id, start_date, target_end_date) ON public.projects TO authenticated;

CREATE POLICY "active members create projects"
ON public.projects FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND created_by = (SELECT auth.uid())
  AND phase = 'kickoff'
  AND closed_at IS NULL
);

-- ============================================================
-- Phase moves
-- ============================================================
-- Phases are manual and may move in either direction: real projects loop back
-- (a discovery finding reopens delivery). Each move is logged. Closing requires
-- an outcome note, and reopening clears the closed date but keeps the note as the
-- record of the last outcome.

CREATE OR REPLACE FUNCTION public.move_project_phase(
  p_project_id UUID,
  p_to_phase TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  proj public.projects;
  old_phase TEXT;
  note TEXT := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_to_phase NOT IN ('kickoff', 'discovery', 'delivery', 'handover', 'closed') THEN
    RAISE EXCEPTION 'unknown project phase %', p_to_phase USING ERRCODE = '22023';
  END IF;

  SELECT * INTO proj FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF proj.phase = p_to_phase THEN
    RAISE EXCEPTION 'project is already in phase %', p_to_phase USING ERRCODE = '22023';
  END IF;

  IF p_to_phase = 'closed' AND note IS NULL THEN
    RAISE EXCEPTION 'an outcome note is required to close a project' USING ERRCODE = '22023';
  END IF;

  old_phase := proj.phase;

  UPDATE public.projects
  SET phase = p_to_phase,
      closed_at = CASE WHEN p_to_phase = 'closed' THEN now() END,
      outcome_note = CASE WHEN p_to_phase = 'closed' THEN note ELSE outcome_note END
  WHERE id = p_project_id
  RETURNING * INTO proj;

  INSERT INTO public.project_activities (project_id, actor_id, kind, from_phase, to_phase, body)
  VALUES (p_project_id, (SELECT auth.uid()), 'phase_change', old_phase, p_to_phase, note);

  RETURN proj;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_project_phase(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- project_activities (append-only log)
-- ============================================================

CREATE TABLE public.project_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'created', 'phase_change', 'field_change', 'note', 'idea_captured'
  )),
  from_phase TEXT,
  to_phase TEXT,
  body TEXT CHECK (body IS NULL OR char_length(body) <= 5000),
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX project_activities_project_id_idx
ON public.project_activities (project_id, created_at DESC);

ALTER TABLE public.project_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read project activities"
ON public.project_activities FOR SELECT TO authenticated
USING (public.is_active_member());

-- Members add notes only. Every other kind is written by a trigger or an RPC.
CREATE POLICY "active members add project notes"
ON public.project_activities FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND actor_id = (SELECT auth.uid())
  AND kind = 'note'
  AND from_phase IS NULL AND to_phase IS NULL AND meta IS NULL
);

REVOKE ALL ON public.project_activities FROM anon, authenticated;
GRANT SELECT ON public.project_activities TO authenticated;
GRANT INSERT (project_id, actor_id, kind, body) ON public.project_activities TO authenticated;

-- Creation and the field changes worth a line in the history. Phase moves are
-- logged by move_project_phase(), with their note.
CREATE OR REPLACE FUNCTION public.projects_log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  field TEXT;
  old_value TEXT;
  new_value TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.project_activities (project_id, actor_id, kind, to_phase)
    VALUES (NEW.id, (SELECT auth.uid()), 'created', NEW.phase);
    RETURN NEW;
  END IF;

  FOREACH field IN ARRAY ARRAY['name', 'owner_id', 'start_date', 'target_end_date', 'ownership']
  LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', field, field)
      INTO old_value, new_value USING OLD, NEW;
    IF old_value IS DISTINCT FROM new_value THEN
      INSERT INTO public.project_activities (project_id, actor_id, kind, meta)
      VALUES (NEW.id, (SELECT auth.uid()), 'field_change',
              jsonb_build_object('field', field, 'from', old_value, 'to', new_value));
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_log_activity
AFTER INSERT OR UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.projects_log_activity();

-- ============================================================
-- Team and watchers
-- ============================================================
-- Team members and watchers follow the rules the rest of Sales uses: the team is
-- small and works together, and you may only add or remove yourself as a
-- watcher.

CREATE TABLE public.project_members (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_members_user_id_idx ON public.project_members (user_id);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read project members"
ON public.project_members FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members add project members"
ON public.project_members FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND added_by = (SELECT auth.uid()));

CREATE POLICY "active members remove project members"
ON public.project_members FOR DELETE TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.project_members FROM anon, authenticated;
GRANT SELECT, DELETE ON public.project_members TO authenticated;
GRANT INSERT (project_id, user_id, added_by) ON public.project_members TO authenticated;

CREATE TABLE public.project_watchers (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_watchers_user_id_idx ON public.project_watchers (user_id, created_at DESC);

ALTER TABLE public.project_watchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read project watchers"
ON public.project_watchers FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "watch a project yourself"
ON public.project_watchers FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND user_id = (SELECT auth.uid()));

CREATE POLICY "unwatch a project yourself"
ON public.project_watchers FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.project_watchers FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.project_watchers TO authenticated;

-- ============================================================
-- Deliverables: knowledge items linked to a project
-- ============================================================
-- The same reading rule as product links: a person sees a linked item only if
-- they could read the item itself.

CREATE TABLE public.knowledge_item_projects (
  item_id UUID NOT NULL REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, project_id)
);

CREATE INDEX knowledge_item_projects_project_id_idx
ON public.knowledge_item_projects (project_id);

ALTER TABLE public.knowledge_item_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "readers see knowledge item project links"
ON public.knowledge_item_projects FOR SELECT TO authenticated
USING (public.can_read_knowledge_item(item_id));

CREATE POLICY "item editors link knowledge items to projects"
ON public.knowledge_item_projects FOR INSERT TO authenticated
WITH CHECK (public.can_edit_knowledge_item(item_id));

CREATE POLICY "item editors unlink knowledge items from projects"
ON public.knowledge_item_projects FOR DELETE TO authenticated
USING (public.can_edit_knowledge_item(item_id));

REVOKE ALL ON public.knowledge_item_projects FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.knowledge_item_projects TO authenticated;

-- ============================================================
-- Capture idea: a project's idea becomes a product at Idea
-- ============================================================
-- The product is owned by the person capturing it and starts at business stage
-- Idea, with origination "discovery". The link is written both ways: the
-- project lists its ideas, and the product shows the project it came from.

CREATE TABLE public.project_products (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, product_id)
);

CREATE INDEX project_products_product_id_idx ON public.project_products (product_id);

ALTER TABLE public.project_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read project products"
ON public.project_products FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.project_products FROM anon, authenticated;
GRANT SELECT ON public.project_products TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_project_idea(
  p_project_id UUID,
  p_name TEXT,
  p_problem TEXT
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  name TEXT := nullif(btrim(coalesce(p_name, '')), '');
  problem TEXT := nullif(btrim(coalesce(p_problem, '')), '');
  base_slug TEXT;
  result public.products;
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF name IS NULL OR char_length(name) > 200 THEN
    RAISE EXCEPTION 'a name of up to 200 characters is required for the idea'
      USING ERRCODE = '22023';
  END IF;

  IF problem IS NULL THEN
    RAISE EXCEPTION 'a problem statement is required for the idea' USING ERRCODE = '22023';
  END IF;

  -- A readable prefix plus a random suffix. Names in Arabic have no ASCII slug,
  -- so they fall back to "idea" and the suffix keeps the slug unique.
  base_slug := left(coalesce(
    nullif(btrim(lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')), '-'), ''),
    'idea'
  ), 40);

  INSERT INTO public.products (name, slug, description, owner_id, origination, business_owner_id)
  VALUES (
    name,
    base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
    problem,
    actor,
    'discovery',
    actor
  )
  RETURNING * INTO result;

  INSERT INTO public.project_products (project_id, product_id, created_by)
  VALUES (p_project_id, result.id, actor);

  INSERT INTO public.project_activities (project_id, actor_id, kind, body, meta)
  VALUES (p_project_id, actor, 'idea_captured', name,
          jsonb_build_object('product_id', result.id));

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.capture_project_idea(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- Channels: a project has its own room
-- ============================================================
-- A project channel follows its project's name and closes with it, the same way
-- a product's primary channel follows the product. It is a third binding kind
-- beside product and standing, so the binding constraint now names all three.

ALTER TABLE public.channels
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.channels
  DROP CONSTRAINT channels_kind_check;

ALTER TABLE public.channels
  ADD CONSTRAINT channels_kind_check
    CHECK (kind IN ('standing', 'product', 'project', 'dm'));

ALTER TABLE public.channels
  DROP CONSTRAINT channels_product_binding;

ALTER TABLE public.channels
  ADD CONSTRAINT channels_kind_binding CHECK (
    (kind = 'product' AND product_id IS NOT NULL AND project_id IS NULL)
    OR (kind = 'project' AND project_id IS NOT NULL AND product_id IS NULL)
    OR (kind IN ('standing', 'dm') AND product_id IS NULL AND project_id IS NULL)
  );

ALTER TABLE public.channels
  DROP CONSTRAINT channels_primary_is_bound;

ALTER TABLE public.channels
  ADD CONSTRAINT channels_primary_is_bound
    CHECK (NOT is_primary OR kind IN ('product', 'project'));

CREATE UNIQUE INDEX channels_one_primary_per_project
ON public.channels (project_id)
WHERE is_primary;

-- A child of a project channel is a project channel too, so the nesting trigger
-- has to carry the binding down as well as the product.
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
  NEW.project_id := parent.project_id;
  NEW.is_primary := false;

  RETURN NEW;
END;
$$;

-- Created by the project trigger. A client may only add a secondary room under
-- a project that is still open, the same rule as product rooms.
CREATE OR REPLACE FUNCTION public.projects_sync_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.channels (
      slug, name, kind, project_id, is_primary, created_by, archived_at
    )
    VALUES (
      'project-' || substr(replace(NEW.id::text, '-', ''), 1, 16),
      left(NEW.name, 80),
      'project',
      NEW.id,
      true,
      NEW.owner_id,
      CASE WHEN NEW.phase = 'closed' THEN now() END
    )
    ON CONFLICT (project_id) WHERE is_primary DO NOTHING;
    RETURN NEW;
  END IF;

  -- The primary room follows the name and the closed state, in both directions:
  -- reopening a project brings its room back.
  UPDATE public.channels
  SET name = left(NEW.name, 80),
      archived_at = CASE WHEN NEW.phase = 'closed' THEN coalesce(archived_at, now()) END
  WHERE project_id = NEW.id
    AND is_primary
    AND (
      name IS DISTINCT FROM left(NEW.name, 80)
      OR archived_at IS DISTINCT FROM CASE WHEN NEW.phase = 'closed' THEN coalesce(archived_at, now()) END
    );

  UPDATE public.channels
  SET archived_at = CASE WHEN NEW.phase = 'closed' THEN coalesce(archived_at, now()) END
  WHERE project_id = NEW.id
    AND NOT is_primary
    AND archived_at IS DISTINCT FROM CASE WHEN NEW.phase = 'closed' THEN coalesce(archived_at, now()) END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_sync_channel_insert
AFTER INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.projects_sync_channel();

CREATE TRIGGER projects_sync_channel_update
AFTER UPDATE OF name, phase ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.projects_sync_channel();

-- Secondary rooms in a project, same rule as product rooms.
CREATE POLICY "active members create project channels"
ON public.channels FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND created_by = (SELECT auth.uid())
  AND kind = 'project'
  AND is_primary = false
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = channels.project_id AND p.phase <> 'closed'
  )
);

GRANT INSERT (project_id) ON public.channels TO authenticated;

-- Backfill: any project that already exists gets its room.
INSERT INTO public.channels (slug, name, kind, project_id, is_primary, created_by, archived_at)
SELECT 'project-' || substr(replace(p.id::text, '-', ''), 1, 16),
       left(p.name, 80), 'project', p.id, true, p.owner_id,
       CASE WHEN p.phase = 'closed' THEN now() END
FROM public.projects p
ON CONFLICT (project_id) WHERE is_primary DO NOTHING;

-- ============================================================
-- product_tasks: a task can belong to a project
-- ============================================================
-- A task is one of three things: a product's task, a project's task, or a
-- general task. Never two at once.

ALTER TABLE public.product_tasks
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD CONSTRAINT product_tasks_one_scope CHECK (
    product_id IS NULL OR project_id IS NULL
  );

CREATE INDEX product_tasks_project_idx
ON public.product_tasks (project_id, status, due_date)
WHERE project_id IS NOT NULL;

-- Restated in full from 20261026120000, with the project rules added. Everything
-- already there is unchanged.
CREATE OR REPLACE FUNCTION public.validate_product_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_product_id UUID;
  parent_project_id UUID;
  grandparent_id UUID;
  release_product_id UUID;
  child_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'task parent and creator are immutable';
    END IF;

    IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'a task cannot change project';
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

    SELECT product_id, project_id, parent_task_id
      INTO parent_product_id, parent_project_id, grandparent_id
    FROM public.product_tasks
    WHERE id = NEW.parent_task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent task not found';
    END IF;
    -- IS DISTINCT FROM, not <>: with NULLs on either side `<>` is NULL, which
    -- raises nothing, and a general subtask would attach to a product task.
    IF parent_product_id IS DISTINCT FROM NEW.product_id
       OR parent_project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'parent task must belong to the same product or project';
    END IF;
    IF grandparent_id IS NOT NULL THEN
      RAISE EXCEPTION 'tasks support one subtask level only';
    END IF;
  END IF;

  IF NEW.release_id IS NOT NULL THEN
    -- Stated before the lookup: a release belongs to a product, so a task with
    -- no product has no release it could legitimately be in.
    IF NEW.product_id IS NULL THEN
      RAISE EXCEPTION 'only a product task can join a release';
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

-- ============================================================
-- move_deal_stage: a consultation win opens a project
-- ============================================================
-- Restated from 20261026120100 because the table it writes to was renamed. The
-- body is otherwise unchanged.

CREATE OR REPLACE FUNCTION public.move_deal_stage(
  p_deal_id UUID,
  p_to_stage TEXT,
  p_reason TEXT DEFAULT NULL,
  p_ownership TEXT DEFAULT NULL
)
RETURNS public.deals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  d public.deals;
  reason TEXT := nullif(btrim(p_reason), '');
  old_stage TEXT;
  from_closed BOOLEAN;
  is_backward BOOLEAN;
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF public.deal_stage_rank(p_to_stage) IS NULL THEN
    RAISE EXCEPTION 'unknown stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  SELECT * INTO d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deal not found' USING ERRCODE = 'P0002';
  END IF;

  IF d.stage = p_to_stage THEN
    RAISE EXCEPTION 'deal is already in stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  old_stage := d.stage;
  from_closed := d.stage IN ('closed_won', 'closed_lost');
  is_backward := from_closed
    OR public.deal_stage_rank(p_to_stage) < public.deal_stage_rank(d.stage);

  IF reason IS NOT NULL AND char_length(reason) > 1000 THEN
    RAISE EXCEPTION 'reason too long' USING ERRCODE = '22023';
  END IF;
  IF is_backward AND reason IS NULL THEN
    RAISE EXCEPTION 'reason required: moving a deal backward' USING ERRCODE = '22023';
  END IF;
  IF p_to_stage = 'closed_lost' AND reason IS NULL THEN
    RAISE EXCEPTION 'reason required: closing a deal as lost' USING ERRCODE = '22023';
  END IF;
  IF p_to_stage = 'closed_won' AND d.type = 'consultation'
     AND (p_ownership IS NULL
          OR p_ownership NOT IN ('client', 'code92_full', 'code92_partial')) THEN
    RAISE EXCEPTION 'ownership required: winning a consultation deal' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deals
  SET stage = p_to_stage,
      stage_changed_at = now(),
      closed_at = CASE WHEN p_to_stage IN ('closed_won', 'closed_lost') THEN now() END,
      close_reason = CASE WHEN p_to_stage = 'closed_lost' THEN reason END
  WHERE id = d.id
  RETURNING * INTO d;

  INSERT INTO public.deal_activities (deal_id, actor_id, kind, from_stage, to_stage, reason)
  VALUES (d.id, (SELECT auth.uid()), 'stage_change',
          old_stage, p_to_stage, reason);

  IF p_to_stage = 'closed_won' THEN
    IF d.type = 'product' THEN
      INSERT INTO public.account_products (account_id, product_id, won_deal_id)
      VALUES (d.account_id, d.product_id, d.id)
      ON CONFLICT (account_id, product_id) DO NOTHING;
    ELSE
      -- A consultation win opens its project in Kickoff, owned by the deal's
      -- owner. Re-winning a reopened deal keeps the one project and updates its
      -- ownership; it does not restart the project.
      INSERT INTO public.projects (account_id, deal_id, name, ownership, owner_id, created_by)
      VALUES (d.account_id, d.id, d.name, p_ownership, d.owner_id, (SELECT auth.uid()))
      ON CONFLICT (deal_id) DO UPDATE SET ownership = EXCLUDED.ownership;
    END IF;
  END IF;

  RETURN d;
END;
$$;

REVOKE ALL ON FUNCTION public.move_deal_stage(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_deal_stage(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- project_overview — the projection the Projects list and the dashboard read
-- ============================================================
-- Stale: an open project with no task or log activity for 14 days. Activity is
-- deliberately not the record's own updated_at, which moves on any edit.

CREATE VIEW public.project_overview
WITH (security_invoker = true)
AS
SELECT
  pr.id,
  pr.name,
  pr.account_id,
  a.name AS account_name,
  pr.deal_id,
  pr.owner_id,
  tm.display_name AS owner_name,
  pr.ownership,
  pr.phase,
  pr.start_date,
  pr.target_end_date,
  pr.closed_at,
  pr.outcome_note,
  pr.created_at,
  pr.updated_at,
  (pr.phase <> 'closed') AS is_open,
  la.last_activity_at,
  (pr.phase <> 'closed' AND la.last_activity_at < now() - interval '14 days') AS is_stale,
  (SELECT count(*)::int FROM public.product_tasks t
    WHERE t.project_id = pr.id) AS task_count,
  (SELECT count(*)::int FROM public.product_tasks t
    WHERE t.project_id = pr.id AND t.status <> 'completed') AS open_task_count,
  (SELECT count(*)::int FROM public.project_products pp
    WHERE pp.project_id = pr.id) AS idea_count,
  (SELECT c.id FROM public.channels c
    WHERE c.project_id = pr.id AND c.is_primary) AS channel_id
FROM public.projects pr
JOIN public.accounts a ON a.id = pr.account_id
LEFT JOIN public.team_members tm ON tm.user_id = pr.owner_id
CROSS JOIN LATERAL (
  SELECT greatest(
    pr.created_at,
    coalesce((SELECT max(pa.created_at) FROM public.project_activities pa
              WHERE pa.project_id = pr.id), pr.created_at),
    coalesce((SELECT max(greatest(t.created_at, t.updated_at)) FROM public.product_tasks t
              WHERE t.project_id = pr.id), pr.created_at)
  ) AS last_activity_at
) la;

GRANT SELECT ON public.project_overview TO authenticated;
