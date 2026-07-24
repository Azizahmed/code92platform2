-- Product work management and image attachments.
-- Adds product logos, Todoist-style tasks/subtasks, task images, and
-- status-update images. All media rows persist both the public URL and the
-- storage object key so objects can be managed safely later.

-- ============================================================
-- Product logo
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN logo_url TEXT,
  ADD COLUMN logo_key TEXT;

GRANT UPDATE (logo_url, logo_key)
ON public.products TO authenticated;

-- ============================================================
-- Product tasks (one parent level + one subtask level)
-- ============================================================

CREATE TABLE public.product_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES public.product_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 5000),
  due_date DATE,
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed')),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_tasks_product_id_idx
ON public.product_tasks (product_id, parent_task_id, status, position, created_at);

CREATE INDEX product_tasks_parent_task_id_idx
ON public.product_tasks (parent_task_id)
WHERE parent_task_id IS NOT NULL;

CREATE INDEX product_tasks_assignee_id_idx
ON public.product_tasks (assignee_id, status, due_date);

CREATE OR REPLACE FUNCTION public.validate_product_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_product_id UUID;
  grandparent_id UUID;
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

  IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status = 'pending' THEN
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_tasks_validate
BEFORE INSERT OR UPDATE ON public.product_tasks
FOR EACH ROW EXECUTE FUNCTION public.validate_product_task();

CREATE TRIGGER product_tasks_updated_at
BEFORE UPDATE ON public.product_tasks
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.product_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read product tasks"
ON public.product_tasks FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members create product tasks"
ON public.product_tasks FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND created_by = (SELECT auth.uid())
);

CREATE POLICY "active members update product tasks"
ON public.product_tasks FOR UPDATE TO authenticated
USING (public.is_active_member())
WITH CHECK (public.is_active_member());

CREATE POLICY "active members delete product tasks"
ON public.product_tasks FOR DELETE TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.product_tasks FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.product_tasks TO authenticated;
GRANT UPDATE (title, notes, due_date, assignee_id, status, position)
ON public.product_tasks TO authenticated;

-- ============================================================
-- Task image attachments
-- ============================================================

CREATE TABLE public.task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.product_tasks(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  storage_url TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (mime_type LIKE 'image/%'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_attachments_task_id_idx
ON public.task_attachments (task_id, created_at);

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read task attachments"
ON public.task_attachments FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members add task attachments"
ON public.task_attachments FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND uploader_id = (SELECT auth.uid())
);

CREATE POLICY "active members delete task attachments"
ON public.task_attachments FOR DELETE TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.task_attachments FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.task_attachments TO authenticated;

-- ============================================================
-- Status update image attachments
-- ============================================================

CREATE TABLE public.status_update_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_update_id UUID NOT NULL
    REFERENCES public.status_updates(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  storage_url TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (mime_type LIKE 'image/%'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX status_update_attachments_update_id_idx
ON public.status_update_attachments (status_update_id, created_at);

ALTER TABLE public.status_update_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read status update attachments"
ON public.status_update_attachments FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members add status update attachments"
ON public.status_update_attachments FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND uploader_id = (SELECT auth.uid())
);

REVOKE ALL ON public.status_update_attachments FROM anon, authenticated;
GRANT SELECT, INSERT ON public.status_update_attachments TO authenticated;

-- Keep the dashboard projection backward compatible and append the logo.
CREATE OR REPLACE VIEW public.product_overview
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.description,
  p.description_ar,
  p.category,
  p.stage,
  p.health,
  p.owner_id,
  tm.display_name AS owner_name,
  p.review_interval_days,
  p.next_review_at,
  p.last_status_update_at,
  p.last_trend_scan_at,
  p.trend_scan_enabled,
  p.archived_at,
  p.created_at,
  (p.next_review_at IS NOT NULL AND p.next_review_at < now()) AS is_overdue,
  GREATEST(
    0,
    EXTRACT(
      EPOCH FROM (now() - COALESCE(p.last_status_update_at, p.created_at))
    ) / 86400
  )::int AS staleness_days,
  lu.summary AS last_update_summary,
  lu.author_name AS last_update_author,
  (
    SELECT count(*)::int
    FROM public.product_trends pt
    WHERE pt.product_id = p.id
      AND pt.dismissed_at IS NULL
      AND pt.created_at > now() - interval '7 days'
  ) AS trend_count_7d,
  p.logo_url
FROM public.products p
LEFT JOIN public.team_members tm ON tm.user_id = p.owner_id
LEFT JOIN LATERAL (
  SELECT su.summary, tum.display_name AS author_name
  FROM public.status_updates su
  LEFT JOIN public.team_members tum ON tum.user_id = su.author_id
  WHERE su.product_id = p.id
  ORDER BY su.created_at DESC
  LIMIT 1
) lu ON true;

GRANT SELECT ON public.product_overview TO authenticated;
