-- Code 92 Command Center: core schema
-- team_members, products, status_updates, trend_items, product_trends,
-- scan_runs, product_overview view, RLS helpers, triggers, admin RPC.

-- ============================================================
-- team_members
-- ============================================================

CREATE TABLE public.team_members (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS helper functions (SECURITY DEFINER to avoid recursive RLS)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_active_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = (SELECT auth.uid()) AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = (SELECT auth.uid()) AND is_active AND role = 'admin'
  );
$$;

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- Active members can read the roster; users can always read their own row
-- (needed for the "awaiting approval" state).
CREATE POLICY "members read roster or self"
ON public.team_members FOR SELECT TO authenticated
USING (public.is_active_member() OR user_id = (SELECT auth.uid()));

-- Signup self-registration: only own row, role/is_active kept at defaults
-- via column-level INSERT grant below.
CREATE POLICY "users register themselves"
ON public.team_members FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.team_members FROM anon, authenticated;
GRANT SELECT ON public.team_members TO authenticated;
GRANT INSERT (user_id, display_name) ON public.team_members TO authenticated;

CREATE TRIGGER team_members_updated_at
BEFORE UPDATE ON public.team_members
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Admin-only role/activation changes; protects the last active admin.
CREATE OR REPLACE FUNCTION public.admin_set_member(
  target UUID,
  new_role TEXT,
  new_active BOOLEAN
)
RETURNS public.team_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_row public.team_members;
  result public.team_members;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'only admins can manage team members';
  END IF;

  IF new_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;

  SELECT * INTO current_row FROM public.team_members WHERE user_id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team member not found: %', target;
  END IF;

  -- Protect the last active admin from demotion/deactivation.
  IF current_row.is_active AND current_row.role = 'admin'
     AND (new_role <> 'admin' OR NOT new_active)
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members
       WHERE is_active AND role = 'admin' AND user_id <> target
     )
  THEN
    RAISE EXCEPTION 'cannot demote or deactivate the last active admin';
  END IF;

  UPDATE public.team_members
  SET role = new_role, is_active = new_active
  WHERE user_id = target
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_member(UUID, TEXT, BOOLEAN) TO authenticated;

-- ============================================================
-- products
-- ============================================================

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  description_ar TEXT,
  category TEXT,
  stage TEXT NOT NULL DEFAULT 'idea'
    CHECK (stage IN ('idea', 'development', 'beta', 'live', 'paused', 'sunset')),
  health TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health IN ('green', 'yellow', 'red', 'unknown')),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  links JSONB NOT NULL DEFAULT '{}',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  trend_scan_enabled BOOLEAN NOT NULL DEFAULT true,
  review_interval_days INTEGER NOT NULL DEFAULT 14 CHECK (review_interval_days > 0),
  next_review_at TIMESTAMPTZ,
  last_status_update_at TIMESTAMPTZ,
  last_trend_scan_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX products_owner_id_idx ON public.products (owner_id);
CREATE INDEX products_archived_at_idx ON public.products (archived_at) WHERE archived_at IS NULL;
CREATE INDEX products_next_review_at_idx ON public.products (next_review_at);
CREATE INDEX products_last_trend_scan_at_idx ON public.products (last_trend_scan_at);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read products"
ON public.products FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members create own products"
ON public.products FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND owner_id = (SELECT auth.uid()));

CREATE POLICY "owner or admin updates products"
ON public.products FOR UPDATE TO authenticated
USING (owner_id = (SELECT auth.uid()) OR public.is_admin())
WITH CHECK (owner_id = (SELECT auth.uid()) OR public.is_admin());

REVOKE ALL ON public.products FROM anon, authenticated;
GRANT SELECT, INSERT ON public.products TO authenticated;
-- Server-maintained fields (health, next_review_at, last_*) are excluded;
-- triggers maintain them. archived_at is admin-guarded by trigger below.
GRANT UPDATE (name, slug, description, description_ar, category, stage,
              owner_id, links, keywords, trend_scan_enabled,
              review_interval_days, archived_at)
ON public.products TO authenticated;

-- Enforce server-maintained initial values and default next_review_at.
CREATE OR REPLACE FUNCTION public.products_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.health := 'unknown';
  NEW.last_status_update_at := NULL;
  NEW.last_trend_scan_at := NULL;
  IF NEW.next_review_at IS NULL THEN
    NEW.next_review_at := now() + make_interval(days => NEW.review_interval_days);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_before_insert
BEFORE INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_before_insert();

-- Only admins may archive/unarchive.
CREATE OR REPLACE FUNCTION public.products_guard_archive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only admins can archive or unarchive products';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_guard_archive
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_guard_archive();

CREATE TRIGGER products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ============================================================
-- status_updates (append-only history)
-- ============================================================

CREATE TABLE public.status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id),
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'github', 'monitoring', 'analytics', 'import')),
  source_ref JSONB,
  health TEXT NOT NULL CHECK (health IN ('green', 'yellow', 'red', 'unknown')),
  stage TEXT CHECK (stage IN ('idea', 'development', 'beta', 'live', 'paused', 'sunset')),
  summary TEXT NOT NULL,
  details TEXT,
  metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX status_updates_product_id_idx ON public.status_updates (product_id, created_at DESC);

ALTER TABLE public.status_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read status updates"
ON public.status_updates FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members post manual updates"
ON public.status_updates FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND author_id = (SELECT auth.uid())
  AND source_type = 'manual'
);

REVOKE ALL ON public.status_updates FROM anon, authenticated;
GRANT SELECT, INSERT ON public.status_updates TO authenticated;

-- Keep the parent product in sync on every new status update.
CREATE OR REPLACE FUNCTION public.status_updates_apply_to_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  UPDATE public.products
  SET health = NEW.health,
      stage = COALESCE(NEW.stage, stage),
      last_status_update_at = NEW.created_at,
      next_review_at = NEW.created_at + make_interval(days => review_interval_days)
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER status_updates_apply_to_product
AFTER INSERT ON public.status_updates
FOR EACH ROW EXECUTE FUNCTION public.status_updates_apply_to_product();

-- ============================================================
-- trend_items (pipeline-only writes)
-- ============================================================

CREATE TABLE public.trend_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  summary_ar TEXT,
  url TEXT,
  url_norm TEXT,
  source_name TEXT,
  published_at TIMESTAMPTZ,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB
);

-- Dedup on normalized URL.
CREATE UNIQUE INDEX trend_items_url_norm_key
ON public.trend_items (url_norm) WHERE url_norm IS NOT NULL;
CREATE INDEX trend_items_found_at_idx ON public.trend_items (found_at DESC);

ALTER TABLE public.trend_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read trend items"
ON public.trend_items FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.trend_items FROM anon, authenticated;
GRANT SELECT ON public.trend_items TO authenticated;

-- ============================================================
-- product_trends (links; members may only dismiss)
-- ============================================================

CREATE TABLE public.product_trends (
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  trend_item_id UUID NOT NULL REFERENCES public.trend_items(id) ON DELETE CASCADE,
  relevance_score REAL CHECK (relevance_score BETWEEN 0 AND 1),
  relevance_note TEXT,
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, trend_item_id)
);

CREATE INDEX product_trends_trend_item_id_idx ON public.product_trends (trend_item_id);
CREATE INDEX product_trends_product_recent_idx
ON public.product_trends (product_id, created_at DESC) WHERE dismissed_at IS NULL;

ALTER TABLE public.product_trends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read product trends"
ON public.product_trends FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members dismiss product trends"
ON public.product_trends FOR UPDATE TO authenticated
USING (public.is_active_member())
WITH CHECK (public.is_active_member());

REVOKE ALL ON public.product_trends FROM anon, authenticated;
GRANT SELECT ON public.product_trends TO authenticated;
GRANT UPDATE (dismissed_at, dismissed_by) ON public.product_trends TO authenticated;

-- dismissed_by must be the caller (or cleared together with dismissed_at).
CREATE OR REPLACE FUNCTION public.product_trends_guard_dismiss()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.dismissed_at IS NOT NULL
     AND (NEW.dismissed_by IS NULL OR NEW.dismissed_by <> (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'dismissed_by must be the current user';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_trends_guard_dismiss
BEFORE UPDATE ON public.product_trends
FOR EACH ROW EXECUTE FUNCTION public.product_trends_guard_dismiss();

-- ============================================================
-- scan_runs (pipeline observability; admin-readable)
-- ============================================================

CREATE TABLE public.scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  products_scanned INTEGER NOT NULL DEFAULT 0,
  items_inserted INTEGER NOT NULL DEFAULT 0,
  items_linked INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.scan_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read scan runs"
ON public.scan_runs FOR SELECT TO authenticated
USING (public.is_admin());

REVOKE ALL ON public.scan_runs FROM anon, authenticated;
GRANT SELECT ON public.scan_runs TO authenticated;

-- ============================================================
-- product_overview view (dashboard, one query)
-- ============================================================

CREATE VIEW public.product_overview
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
  GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(p.last_status_update_at, p.created_at))) / 86400)::int AS staleness_days,
  lu.summary AS last_update_summary,
  lu.author_name AS last_update_author,
  (SELECT count(*)::int
   FROM public.product_trends pt
   WHERE pt.product_id = p.id
     AND pt.dismissed_at IS NULL
     AND pt.created_at > now() - interval '7 days') AS trend_count_7d
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
