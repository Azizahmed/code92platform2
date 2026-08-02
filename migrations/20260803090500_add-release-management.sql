-- Release management: the cycle layer over the lifecycle.
--
-- product_lifecycle_phases answers "where is this product in the process".
-- A release answers "what are we shipping, when, and what had to be true first".
-- They are different questions: a product sits in `monitor` for a year while
-- shipping a release a fortnight, and each of those releases needs its own
-- checklist, its own scope of work, and its own record of who signed it off.
--
-- The governance shape deliberately mirrors the lifecycle migration rather than
-- inventing a second vocabulary: required items by risk tier, a gate that only
-- bites at the final step, a written waiver for high-risk gaps, and an
-- append-only transition log. If you have read
-- 20260727192151_add-product-lifecycle.sql, you have read this one.

-- ============================================================
-- Vocabulary
-- ============================================================
-- Authoritative here, mirrored in lib/releases.ts for the pre-submit checklist.
-- Change both together.

CREATE OR REPLACE FUNCTION public.release_status_index(p_status TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'planned'     THEN 1
    WHEN 'in_progress' THEN 2
    WHEN 'ready'       THEN 3
    WHEN 'released'    THEN 4
    WHEN 'rolled_back' THEN 5
    WHEN 'cancelled'   THEN 6
  END;
$$;

-- Which checks a release must clear before it may be marked released, by the
-- product's risk tier. Low-risk releases still write release notes — that is
-- the one thing with no cost and no excuse.
CREATE OR REPLACE FUNCTION public.release_required_checks(p_risk_tier TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_risk_tier
    WHEN 'low'    THEN ARRAY['release_notes']
    WHEN 'medium' THEN ARRAY['release_notes', 'qa_signoff', 'rollback_plan']
    WHEN 'high'   THEN ARRAY[
      'release_notes', 'qa_signoff', 'rollback_plan',
      'security_signoff', 'change_approval'
    ]
    ELSE ARRAY['release_notes']
  END;
$$;

-- Which status may follow which. Cancelled and rolled_back are not dead ends:
-- a cancelled release gets re-planned, and a rolled-back one goes back to work.
CREATE OR REPLACE FUNCTION public.release_status_can_follow(
  p_from TEXT,
  p_to TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_to = ANY (CASE p_from
    WHEN 'planned'     THEN ARRAY['in_progress', 'cancelled']
    WHEN 'in_progress' THEN ARRAY['ready', 'planned', 'cancelled']
    WHEN 'ready'       THEN ARRAY['released', 'in_progress', 'cancelled']
    WHEN 'released'    THEN ARRAY['rolled_back']
    WHEN 'rolled_back' THEN ARRAY['in_progress']
    WHEN 'cancelled'   THEN ARRAY['planned']
    ELSE ARRAY[]::TEXT[]
  END);
$$;

-- ============================================================
-- Who may manage a product's releases
-- ============================================================
-- Same rule as the lifecycle: the product owner or an admin, and never on an
-- archived product. SECURITY DEFINER so the policies below do not re-run the
-- products policies once per row.

CREATE OR REPLACE FUNCTION public.can_manage_release_for_product(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.is_active_member() AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.archived_at IS NULL
      AND (p.owner_id = (SELECT auth.uid()) OR public.is_admin())
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_release_for_product(UUID)
TO authenticated;

-- ============================================================
-- product_releases
-- ============================================================

CREATE TABLE public.product_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  version TEXT NOT NULL CHECK (char_length(btrim(version)) BETWEEN 1 AND 60),
  name TEXT CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 240),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 5000),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'in_progress', 'ready', 'released', 'rolled_back', 'cancelled')
  ),
  target_date DATE,
  released_at TIMESTAMPTZ,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One v1.2.0 per product. Two products may both ship a v1.2.0.
  UNIQUE (product_id, version),

  -- released_at is the moment it went out, and it survives a rollback: the
  -- rollback is a new fact about a release that did happen, not an erasure.
  CONSTRAINT product_releases_released_at_state CHECK (
    (released_at IS NOT NULL) = (status IN ('released', 'rolled_back'))
  )
);

CREATE INDEX product_releases_product_id_idx
ON public.product_releases (product_id, status, target_date);

CREATE INDEX product_releases_status_idx
ON public.product_releases (status, target_date);

CREATE INDEX product_releases_owner_id_idx
ON public.product_releases (owner_id);

CREATE OR REPLACE FUNCTION public.validate_product_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.version := btrim(NEW.version);
  NEW.name := nullif(btrim(coalesce(NEW.name, '')), '');
  NEW.notes := nullif(btrim(coalesce(NEW.notes, '')), '');

  IF TG_OP = 'UPDATE' AND (
    NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'release product and creator are immutable';
  END IF;

  -- status moves only through advance_release_status(), which is SECURITY
  -- DEFINER and therefore not subject to the column grants below. A client
  -- holds no UPDATE grant on `status`, so this is belt and braces for any
  -- future trusted writer that forgets the gate.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.release_status_can_follow(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'a release cannot move from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_releases_validate
BEFORE INSERT OR UPDATE ON public.product_releases
FOR EACH ROW EXECUTE FUNCTION public.validate_product_release();

CREATE TRIGGER product_releases_updated_at
BEFORE UPDATE ON public.product_releases
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.product_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read releases"
ON public.product_releases FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "owner or admin creates releases"
ON public.product_releases FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_release_for_product(product_id)
  AND created_by = (SELECT auth.uid())
);

CREATE POLICY "owner or admin edits releases"
ON public.product_releases FOR UPDATE TO authenticated
USING (public.can_manage_release_for_product(product_id))
WITH CHECK (public.can_manage_release_for_product(product_id));

CREATE POLICY "owner or admin deletes releases"
ON public.product_releases FOR DELETE TO authenticated
USING (
  public.can_manage_release_for_product(product_id)
  AND status <> 'released'
);

REVOKE ALL ON public.product_releases FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.product_releases TO authenticated;

-- No `status` and no `released_at`: those move only through
-- advance_release_status(), so the gate and the audit row cannot be skipped.
GRANT UPDATE (version, name, notes, target_date, owner_id)
ON public.product_releases TO authenticated;

-- Release-scoped form of the same rule, for the checklist write path. Defined
-- after the table because a SQL function body is parsed at creation time.
CREATE OR REPLACE FUNCTION public.can_manage_release(p_release_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.product_releases r
    WHERE r.id = p_release_id
      AND public.can_manage_release_for_product(r.product_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_release(UUID) TO authenticated;

-- ============================================================
-- release_checks
-- ============================================================
-- Seeded once, at creation, from the product's risk tier at that moment. If the
-- tier changes later the seeded list does NOT change: the checklist a release
-- was held to is part of its record, and silently rewriting it would make the
-- audit log a description of the present rather than of what happened.

CREATE TABLE public.release_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL
    REFERENCES public.product_releases(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL CHECK (
    check_key IN (
      'release_notes', 'qa_signoff', 'rollback_plan',
      'security_signoff', 'change_approval'
    )
  ),
  is_required BOOLEAN NOT NULL DEFAULT true,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (release_id, check_key),
  CONSTRAINT release_checks_completed_complete CHECK (
    num_nonnulls(completed_at, completed_by) IN (0, 2)
  )
);

CREATE INDEX release_checks_release_id_idx
ON public.release_checks (release_id, check_key);

ALTER TABLE public.release_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read release checks"
ON public.release_checks FOR SELECT TO authenticated
USING (public.is_active_member());

-- Read-only to clients: set_release_check() is the write path, so the
-- completed_by recorded against a check is always the caller.
REVOKE ALL ON public.release_checks FROM anon, authenticated;
GRANT SELECT ON public.release_checks TO authenticated;

CREATE OR REPLACE FUNCTION public.releases_seed_checks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  tier TEXT;
BEGIN
  SELECT p.risk_tier INTO tier
  FROM public.products p WHERE p.id = NEW.product_id;

  INSERT INTO public.release_checks (release_id, check_key, is_required)
  SELECT NEW.id, k, true
  FROM unnest(public.release_required_checks(coalesce(tier, 'medium'))) AS k;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_releases_seed_checks
AFTER INSERT ON public.product_releases
FOR EACH ROW EXECUTE FUNCTION public.releases_seed_checks();

CREATE OR REPLACE FUNCTION public.set_release_check(
  p_release_id UUID,
  p_check_key TEXT,
  p_done BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS public.release_checks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  result public.release_checks;
  rel_status TEXT;
BEGIN
  IF NOT public.can_manage_release(p_release_id) THEN
    RAISE EXCEPTION 'only the product owner or an admin can complete release checks';
  END IF;

  SELECT status INTO rel_status
  FROM public.product_releases WHERE id = p_release_id;

  IF rel_status IN ('released', 'cancelled') THEN
    RAISE EXCEPTION 'the checklist of a % release is closed', rel_status;
  END IF;

  UPDATE public.release_checks
  SET completed_at = CASE WHEN p_done THEN now() END,
      completed_by = CASE WHEN p_done THEN actor END,
      note = nullif(btrim(coalesce(p_note, '')), '')
  WHERE release_id = p_release_id AND check_key = p_check_key
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'check % does not apply to this release', p_check_key;
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_release_check(UUID, TEXT, BOOLEAN, TEXT)
TO authenticated;

-- ============================================================
-- product_tasks.release_id — the scope of a release
-- ============================================================

ALTER TABLE public.product_tasks
  ADD COLUMN release_id UUID
    REFERENCES public.product_releases(id) ON DELETE SET NULL;

CREATE INDEX product_tasks_release_id_idx
ON public.product_tasks (release_id, status)
WHERE release_id IS NOT NULL;

GRANT UPDATE (release_id) ON public.product_tasks TO authenticated;

-- A task may only join a release of its own product. A CHECK cannot reach the
-- releases table, so this extends the existing validator.
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

  IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status = 'pending' THEN
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- release_transitions (append-only audit)
-- ============================================================

CREATE TABLE public.release_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL
    REFERENCES public.product_releases(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  risk_tier_at_time TEXT NOT NULL,
  -- Unfinished required checks at the moment of the move, plus the pseudo-entry
  -- 'open_tasks' when work scoped into the release was still pending. Both are
  -- gaps a reader of the log needs to see; neither is a check row.
  missing_checks TEXT[] NOT NULL DEFAULT '{}',
  waiver_reason TEXT,
  -- True when the approving admin is also the product owner. Not blocked —
  -- surfaced, exactly as phase_transitions does.
  self_approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX release_transitions_release_id_idx
ON public.release_transitions (release_id, created_at DESC);

CREATE INDEX release_transitions_product_id_idx
ON public.release_transitions (product_id, created_at DESC);

CREATE INDEX release_transitions_waivers_idx
ON public.release_transitions (created_at DESC)
WHERE waiver_reason IS NOT NULL;

ALTER TABLE public.release_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read release transitions"
ON public.release_transitions FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.release_transitions FROM anon, authenticated;
GRANT SELECT ON public.release_transitions TO authenticated;

-- ============================================================
-- advance_release_status — the only status write path
-- ============================================================

CREATE OR REPLACE FUNCTION public.advance_release_status(
  p_release_id UUID,
  p_status TEXT,
  p_waiver_reason TEXT DEFAULT NULL
)
RETURNS public.product_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  rel public.product_releases;
  prod public.products;
  actor UUID := (SELECT auth.uid());
  is_owner BOOLEAN;
  admin BOOLEAN;
  missing TEXT[];
  open_tasks INTEGER;
  reason TEXT := nullif(btrim(coalesce(p_waiver_reason, '')), '');
  result public.product_releases;
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'only active members can change a release';
  END IF;

  IF public.release_status_index(p_status) IS NULL THEN
    RAISE EXCEPTION 'invalid release status: %', p_status;
  END IF;

  SELECT * INTO rel FROM public.product_releases WHERE id = p_release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release not found';
  END IF;

  SELECT * INTO prod FROM public.products WHERE id = rel.product_id;

  IF prod.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot change a release of an archived product';
  END IF;

  is_owner := prod.owner_id = actor;
  admin := public.is_admin();

  IF NOT (is_owner OR admin) THEN
    RAISE EXCEPTION 'only the product owner or an admin can change a release';
  END IF;

  -- Risk tiering, same rule as the lifecycle: high-risk is admin-only.
  IF prod.risk_tier = 'high' AND NOT admin THEN
    RAISE EXCEPTION 'high-risk products require an admin to change a release';
  END IF;

  IF rel.status = p_status THEN
    RETURN rel;
  END IF;

  IF NOT public.release_status_can_follow(rel.status, p_status) THEN
    RAISE EXCEPTION 'a release cannot move from % to %', rel.status, p_status;
  END IF;

  SELECT coalesce(array_agg(c.check_key ORDER BY c.check_key), ARRAY[]::TEXT[])
    INTO missing
  FROM public.release_checks c
  WHERE c.release_id = rel.id
    AND c.is_required
    AND c.completed_at IS NULL;

  SELECT count(*)::int INTO open_tasks
  FROM public.product_tasks t
  WHERE t.release_id = rel.id AND t.status <> 'completed';

  IF open_tasks > 0 THEN
    missing := missing || ARRAY['open_tasks'];
  END IF;

  -- The gate bites only on the way out of the door. Everything before
  -- `released` is planning, and blocking planning teaches people to plan
  -- somewhere else.
  IF p_status = 'released' AND cardinality(missing) > 0
     AND prod.risk_tier = 'high' AND reason IS NULL THEN
    RAISE EXCEPTION
      'release % has unmet checks (%); a waiver reason is required for high-risk products',
      rel.version, array_to_string(missing, ', ');
  END IF;

  UPDATE public.product_releases
  SET status = p_status,
      released_at = CASE
        WHEN p_status = 'released' THEN now()
        WHEN p_status = 'rolled_back' THEN released_at
        ELSE NULL
      END
  WHERE id = rel.id
  RETURNING * INTO result;

  INSERT INTO public.release_transitions (
    release_id, product_id, from_status, to_status, actor_id,
    risk_tier_at_time, missing_checks, waiver_reason, self_approved
  ) VALUES (
    rel.id, rel.product_id, rel.status, p_status, actor,
    prod.risk_tier,
    CASE WHEN p_status = 'released' THEN missing ELSE ARRAY[]::TEXT[] END,
    CASE WHEN p_status = 'released' AND cardinality(missing) > 0 THEN reason END,
    is_owner AND admin
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_release_status(UUID, TEXT, TEXT)
TO authenticated;

-- ============================================================
-- release_overview — the projection every release surface reads
-- ============================================================

CREATE VIEW public.release_overview
WITH (security_invoker = true)
AS
SELECT
  r.id,
  r.product_id,
  p.name AS product_name,
  p.slug AS product_slug,
  p.logo_url AS product_logo_url,
  p.risk_tier,
  p.archived_at AS product_archived_at,
  r.version,
  r.name,
  r.notes,
  r.status,
  r.target_date,
  r.released_at,
  r.owner_id,
  tm.display_name AS owner_name,
  r.created_by,
  r.created_at,
  r.updated_at,
  (
    r.target_date IS NOT NULL
    AND r.target_date < current_date
    AND r.status NOT IN ('released', 'cancelled')
  ) AS is_overdue,
  (SELECT count(*)::int FROM public.release_checks c
    WHERE c.release_id = r.id AND c.is_required) AS checks_required,
  (SELECT count(*)::int FROM public.release_checks c
    WHERE c.release_id = r.id AND c.is_required
      AND c.completed_at IS NOT NULL) AS checks_done,
  (SELECT count(*)::int FROM public.product_tasks t
    WHERE t.release_id = r.id) AS task_count,
  (SELECT count(*)::int FROM public.product_tasks t
    WHERE t.release_id = r.id AND t.status <> 'completed') AS open_task_count
FROM public.product_releases r
JOIN public.products p ON p.id = r.product_id
LEFT JOIN public.team_members tm ON tm.user_id = r.owner_id;

GRANT SELECT ON public.release_overview TO authenticated;
