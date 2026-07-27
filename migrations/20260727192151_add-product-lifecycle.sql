-- Product implementation lifecycle: Ideation → Requirements → Plan →
-- Code & Testing → Deploy → Monitor.
--
-- This is a second, independent axis from products.stage. `stage` says what a
-- product IS in the market (idea/beta/live/…); the lifecycle says where it is
-- in the delivery process. A live product can be back in `requirements` for v2.
--
-- Governance follows the model in Anthropic's AI-native SDLC writeup: products
-- carry a risk tier, the tier decides which artifacts a phase requires, and
-- every phase transition is recorded append-only with what was missing and why
-- it was waived. Governance is a reporting layer over these tables, not a
-- seventh phase.

-- ============================================================
-- products.risk_tier
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN risk_tier TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_tier IN ('low', 'medium', 'high'));

GRANT UPDATE (risk_tier) ON public.products TO authenticated;

-- The tier decides how strict every gate on the product is, so only admins may
-- move it. Modelled on products_guard_archive; the trusted status-update
-- trigger never touches risk_tier, so it passes through untouched.
CREATE OR REPLACE FUNCTION public.products_guard_risk_tier()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.risk_tier IS DISTINCT FROM OLD.risk_tier
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only admins can change a product risk tier';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_guard_risk_tier
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_guard_risk_tier();

-- ============================================================
-- Lifecycle vocabulary
-- ============================================================
-- These three functions are the authoritative policy. lib/lifecycle.ts mirrors
-- them so the UI can render the checklist before submitting — change both
-- together. Enforcement lives here because a client-side gate is decoration.

CREATE OR REPLACE FUNCTION public.lifecycle_phase_index(p_phase TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_phase
    WHEN 'ideation'     THEN 1
    WHEN 'requirements' THEN 2
    WHEN 'plan'         THEN 3
    WHEN 'code_test'    THEN 4
    WHEN 'deploy'       THEN 5
    WHEN 'monitor'      THEN 6
  END;
$$;

-- Which artifact types may be filed against each phase.
CREATE OR REPLACE FUNCTION public.lifecycle_phase_artifact_types(p_phase TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_phase
    WHEN 'ideation'     THEN ARRAY['concept_brief', 'research_note', 'other']
    WHEN 'requirements' THEN ARRAY['prd', 'threat_model', 'data_classification', 'other']
    WHEN 'plan'         THEN ARRAY['design_doc', 'psr', 'architecture_decision', 'other']
    WHEN 'code_test'    THEN ARRAY['security_review', 'test_report', 'review_evidence', 'other']
    WHEN 'deploy'       THEN ARRAY['deploy_checklist', 'dast_scan', 'pentest_report', 'other']
    WHEN 'monitor'      THEN ARRAY['runbook', 'postmortem', 'metrics_report', 'other']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

-- Which of those are REQUIRED before the phase may be completed, by risk tier.
-- Low-risk products require nothing anywhere: the tier exists so small internal
-- tools stay frictionless while high-risk ones cannot ship unreviewed.
CREATE OR REPLACE FUNCTION public.lifecycle_required_artifacts(
  p_phase TEXT,
  p_risk_tier TEXT
)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_risk_tier = 'low' THEN ARRAY[]::TEXT[]
    WHEN p_phase = 'requirements' AND p_risk_tier = 'medium' THEN ARRAY['prd']
    WHEN p_phase = 'requirements' AND p_risk_tier = 'high'   THEN ARRAY['prd', 'threat_model']
    WHEN p_phase = 'plan'         AND p_risk_tier = 'medium' THEN ARRAY['design_doc']
    WHEN p_phase = 'plan'         AND p_risk_tier = 'high'   THEN ARRAY['design_doc', 'psr']
    WHEN p_phase = 'code_test'    AND p_risk_tier = 'medium' THEN ARRAY['test_report']
    WHEN p_phase = 'code_test'    AND p_risk_tier = 'high'   THEN ARRAY['test_report', 'security_review']
    WHEN p_phase = 'deploy'       AND p_risk_tier = 'medium' THEN ARRAY['deploy_checklist']
    WHEN p_phase = 'deploy'       AND p_risk_tier = 'high'   THEN ARRAY['deploy_checklist', 'dast_scan']
    WHEN p_phase = 'monitor'      AND p_risk_tier = 'high'   THEN ARRAY['runbook']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

-- ============================================================
-- product_lifecycle_phases
-- ============================================================
-- One row per (product, cycle, phase). Per-phase state rather than a single
-- pointer, so the bar can honestly show "Deploy complete, Monitor blocked".
--
-- `cycle` ships unused by the v1 UI. Products loop back through the lifecycle
-- for v2; having the column now means that is a feature, not a migration
-- through live data.

CREATE TABLE public.product_lifecycle_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cycle INTEGER NOT NULL DEFAULT 1 CHECK (cycle > 0),
  phase TEXT NOT NULL CHECK (
    phase IN ('ideation', 'requirements', 'plan', 'code_test', 'deploy', 'monitor')
  ),
  state TEXT NOT NULL DEFAULT 'not_started' CHECK (
    state IN ('not_started', 'in_progress', 'blocked', 'complete')
  ),
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 5000),
  entered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, cycle, phase)
);

CREATE TRIGGER product_lifecycle_phases_updated_at
BEFORE UPDATE ON public.product_lifecycle_phases
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.product_lifecycle_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read lifecycle phases"
ON public.product_lifecycle_phases FOR SELECT TO authenticated
USING (public.is_active_member());

-- Read-only to clients. Every write goes through advance_lifecycle_phase or
-- set_lifecycle_phase_details so the gate and the audit row cannot be skipped.
REVOKE ALL ON public.product_lifecycle_phases FROM anon, authenticated;
GRANT SELECT ON public.product_lifecycle_phases TO authenticated;

-- Edit rights for artifacts hanging off a phase. SECURITY DEFINER so the
-- artifact policies don't re-run the products policies per row.
CREATE OR REPLACE FUNCTION public.can_edit_lifecycle_phase(p_phase_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.is_active_member() AND EXISTS (
    SELECT 1
    FROM public.product_lifecycle_phases lp
    JOIN public.products p ON p.id = lp.product_id
    WHERE lp.id = p_phase_id
      AND p.archived_at IS NULL
      AND (p.owner_id = (SELECT auth.uid()) OR public.is_admin())
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_edit_lifecycle_phase(UUID) TO authenticated;

-- ============================================================
-- phase_artifacts
-- ============================================================
-- The evidence behind a phase: an uploaded file, an external link, or a
-- citation of an existing knowledge-base item. File columns follow the house
-- url+key convention from status_update_attachments; the bucket is private, so
-- storage_url is kept only for that convention and readers always get a freshly
-- signed URL.
--
-- generated_by/agent_run_id are reserved for the automated Project Security
-- Review described in the Anthropic writeup. v1 uploads the PSR by hand; wiring
-- an edge function later needs no migration.

CREATE TABLE public.phase_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id UUID NOT NULL
    REFERENCES public.product_lifecycle_phases(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  storage_url TEXT,
  storage_key TEXT UNIQUE,
  file_name TEXT CHECK (file_name IS NULL OR char_length(file_name) BETWEEN 1 AND 255),
  mime_type TEXT,
  size_bytes BIGINT
    CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 52428800)),
  url TEXT CHECK (url IS NULL OR url ~ '^https?://'),
  knowledge_item_id UUID
    REFERENCES public.knowledge_items(id) ON DELETE SET NULL,
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 5000),
  generated_by TEXT NOT NULL DEFAULT 'human'
    CHECK (generated_by IN ('human', 'agent')),
  agent_run_id UUID,
  uploader_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- An uploaded file is all-or-nothing.
  CONSTRAINT phase_artifacts_file_complete CHECK (
    num_nonnulls(storage_url, storage_key, file_name, mime_type, size_bytes) IN (0, 5)
  ),
  -- An artifact has to actually point at something.
  CONSTRAINT phase_artifacts_body_present CHECK (
    storage_key IS NOT NULL OR url IS NOT NULL OR knowledge_item_id IS NOT NULL
  )
);

CREATE INDEX phase_artifacts_phase_id_idx
ON public.phase_artifacts (phase_id, created_at);

CREATE INDEX phase_artifacts_type_idx
ON public.phase_artifacts (phase_id, artifact_type);

CREATE INDEX phase_artifacts_knowledge_item_idx
ON public.phase_artifacts (knowledge_item_id)
WHERE knowledge_item_id IS NOT NULL;

CREATE INDEX phase_artifacts_uploader_id_idx
ON public.phase_artifacts (uploader_id);

-- A CHECK cannot reach the parent row to validate artifact_type against the
-- phase it belongs to, so this mirrors validate_product_task().
CREATE OR REPLACE FUNCTION public.validate_phase_artifact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_phase TEXT;
BEGIN
  NEW.title := btrim(NEW.title);

  IF TG_OP = 'UPDATE' AND (
    NEW.phase_id IS DISTINCT FROM OLD.phase_id
    OR NEW.uploader_id IS DISTINCT FROM OLD.uploader_id
  ) THEN
    RAISE EXCEPTION 'artifact phase and uploader are immutable';
  END IF;

  SELECT lp.phase INTO parent_phase
  FROM public.product_lifecycle_phases lp
  WHERE lp.id = NEW.phase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle phase not found';
  END IF;

  IF NOT (NEW.artifact_type = ANY (public.lifecycle_phase_artifact_types(parent_phase))) THEN
    RAISE EXCEPTION 'artifact type % is not valid for phase %',
      NEW.artifact_type, parent_phase;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER phase_artifacts_validate
BEFORE INSERT OR UPDATE ON public.phase_artifacts
FOR EACH ROW EXECUTE FUNCTION public.validate_phase_artifact();

ALTER TABLE public.phase_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read phase artifacts"
ON public.phase_artifacts FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "product owner or admin adds phase artifacts"
ON public.phase_artifacts FOR INSERT TO authenticated
WITH CHECK (
  public.can_edit_lifecycle_phase(phase_id)
  AND uploader_id = (SELECT auth.uid())
);

CREATE POLICY "product owner or admin removes phase artifacts"
ON public.phase_artifacts FOR DELETE TO authenticated
USING (public.can_edit_lifecycle_phase(phase_id));

-- No UPDATE: an artifact is evidence. Replacing one means deleting it and
-- filing a new row, which keeps the record honest.
REVOKE ALL ON public.phase_artifacts FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.phase_artifacts TO authenticated;

-- ============================================================
-- phase_transitions (append-only audit)
-- ============================================================
-- "All decisions logged with reasoning." Written only by
-- advance_lifecycle_phase, never by clients.

CREATE TABLE public.phase_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cycle INTEGER NOT NULL DEFAULT 1,
  phase TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  risk_tier_at_time TEXT NOT NULL,
  missing_artifacts TEXT[] NOT NULL DEFAULT '{}',
  waiver_reason TEXT,
  -- True when the approving admin is also the product owner. Not blocked —
  -- surfaced, so /governance can show who signed off on their own work.
  self_approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX phase_transitions_product_id_idx
ON public.phase_transitions (product_id, created_at DESC);

CREATE INDEX phase_transitions_created_at_idx
ON public.phase_transitions (created_at DESC);

CREATE INDEX phase_transitions_waivers_idx
ON public.phase_transitions (created_at DESC)
WHERE waiver_reason IS NOT NULL;

ALTER TABLE public.phase_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read phase transitions"
ON public.phase_transitions FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.phase_transitions FROM anon, authenticated;
GRANT SELECT ON public.phase_transitions TO authenticated;

-- ============================================================
-- advance_lifecycle_phase — the only write path
-- ============================================================

CREATE OR REPLACE FUNCTION public.advance_lifecycle_phase(
  p_phase_id UUID,
  p_state TEXT,
  p_waiver_reason TEXT DEFAULT NULL
)
RETURNS public.product_lifecycle_phases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  lp public.product_lifecycle_phases;
  prod public.products;
  actor UUID := (SELECT auth.uid());
  is_owner BOOLEAN;
  admin BOOLEAN;
  required TEXT[];
  present TEXT[];
  missing TEXT[];
  reason TEXT := nullif(btrim(coalesce(p_waiver_reason, '')), '');
  result public.product_lifecycle_phases;
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'only active members can change lifecycle phases';
  END IF;

  IF p_state NOT IN ('not_started', 'in_progress', 'blocked', 'complete') THEN
    RAISE EXCEPTION 'invalid lifecycle state: %', p_state;
  END IF;

  SELECT * INTO lp FROM public.product_lifecycle_phases WHERE id = p_phase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle phase not found';
  END IF;

  SELECT * INTO prod FROM public.products WHERE id = lp.product_id;

  IF prod.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot change the lifecycle of an archived product';
  END IF;

  is_owner := prod.owner_id = actor;
  admin := public.is_admin();

  IF NOT (is_owner OR admin) THEN
    RAISE EXCEPTION 'only the product owner or an admin can change lifecycle phases';
  END IF;

  -- Risk tiering: high-risk products are an admin-only surface.
  IF prod.risk_tier = 'high' AND NOT admin THEN
    RAISE EXCEPTION 'high-risk products require an admin to change lifecycle phases';
  END IF;

  required := public.lifecycle_required_artifacts(lp.phase, prod.risk_tier);

  SELECT coalesce(array_agg(DISTINCT pa.artifact_type), ARRAY[]::TEXT[])
    INTO present
  FROM public.phase_artifacts pa
  WHERE pa.phase_id = lp.id;

  SELECT coalesce(array_agg(r), ARRAY[]::TEXT[]) INTO missing
  FROM unnest(required) AS r
  WHERE NOT (r = ANY (present));

  -- The gate only bites on completion. Low/medium advance with the gap
  -- recorded; high-risk needs an explicit written waiver.
  IF p_state = 'complete' AND cardinality(missing) > 0
     AND prod.risk_tier = 'high' AND reason IS NULL THEN
    RAISE EXCEPTION
      'phase % is missing required artifacts (%); a waiver reason is required for high-risk products',
      lp.phase, array_to_string(missing, ', ');
  END IF;

  UPDATE public.product_lifecycle_phases
  SET state = p_state,
      entered_at = CASE
        WHEN p_state = 'not_started' THEN NULL
        WHEN entered_at IS NULL THEN now()
        ELSE entered_at
      END,
      completed_at = CASE WHEN p_state = 'complete' THEN now() ELSE NULL END
  WHERE id = lp.id
  RETURNING * INTO result;

  -- Completing a phase pulls the next untouched one into progress.
  IF p_state = 'complete' THEN
    UPDATE public.product_lifecycle_phases nextp
    SET state = 'in_progress',
        entered_at = now()
    WHERE nextp.product_id = lp.product_id
      AND nextp.cycle = lp.cycle
      AND public.lifecycle_phase_index(nextp.phase)
          = public.lifecycle_phase_index(lp.phase) + 1
      AND nextp.state = 'not_started';
  END IF;

  INSERT INTO public.phase_transitions (
    product_id, cycle, phase, from_state, to_state, actor_id,
    risk_tier_at_time, missing_artifacts, waiver_reason, self_approved
  ) VALUES (
    lp.product_id, lp.cycle, lp.phase, lp.state, p_state, actor,
    prod.risk_tier,
    CASE WHEN p_state = 'complete' THEN missing ELSE ARRAY[]::TEXT[] END,
    CASE WHEN p_state = 'complete' AND cardinality(missing) > 0 THEN reason END,
    is_owner AND admin
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_lifecycle_phase(UUID, TEXT, TEXT)
TO authenticated;

-- Owner/notes edits carry no gate and produce no transition row.
CREATE OR REPLACE FUNCTION public.set_lifecycle_phase_details(
  p_phase_id UUID,
  p_owner_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.product_lifecycle_phases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  result public.product_lifecycle_phases;
BEGIN
  IF NOT public.can_edit_lifecycle_phase(p_phase_id) THEN
    RAISE EXCEPTION 'only the product owner or an admin can edit lifecycle phases';
  END IF;

  UPDATE public.product_lifecycle_phases
  SET owner_id = p_owner_id,
      notes = nullif(btrim(coalesce(p_notes, '')), '')
  WHERE id = p_phase_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_lifecycle_phase_details(UUID, UUID, TEXT)
TO authenticated;

-- ============================================================
-- Seed phases for every product
-- ============================================================

CREATE OR REPLACE FUNCTION public.products_seed_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.product_lifecycle_phases (
    product_id, cycle, phase, state, entered_at
  )
  SELECT
    NEW.id,
    1,
    ph,
    CASE WHEN ph = 'ideation' THEN 'in_progress' ELSE 'not_started' END,
    CASE WHEN ph = 'ideation' THEN now() END
  FROM unnest(ARRAY[
    'ideation', 'requirements', 'plan', 'code_test', 'deploy', 'monitor'
  ]) AS ph;

  RETURN NEW;
END;
$$;

CREATE TRIGGER products_seed_lifecycle
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_seed_lifecycle();

-- Backfill existing products. The phase implied by the current market stage is
-- marked in_progress and everything else is left not_started — earlier phases
-- are deliberately NOT marked complete, because no artifacts sit behind them
-- and the visible gap is the point of the feature.
INSERT INTO public.product_lifecycle_phases (
  product_id, cycle, phase, state, entered_at
)
SELECT
  p.id,
  1,
  ph,
  CASE WHEN ph = CASE p.stage
                   WHEN 'idea'        THEN 'ideation'
                   WHEN 'development' THEN 'code_test'
                   WHEN 'beta'        THEN 'deploy'
                   WHEN 'live'        THEN 'monitor'
                   ELSE NULL
                 END
       THEN 'in_progress'
       ELSE 'not_started'
  END,
  CASE WHEN ph = CASE p.stage
                   WHEN 'idea'        THEN 'ideation'
                   WHEN 'development' THEN 'code_test'
                   WHEN 'beta'        THEN 'deploy'
                   WHEN 'live'        THEN 'monitor'
                   ELSE NULL
                 END
       THEN now()
  END
FROM public.products p
CROSS JOIN unnest(ARRAY[
  'ideation', 'requirements', 'plan', 'code_test', 'deploy', 'monitor'
]) AS ph
ON CONFLICT (product_id, cycle, phase) DO NOTHING;

-- ============================================================
-- product_lifecycle_overview — the /governance projection
-- ============================================================

CREATE VIEW public.product_lifecycle_overview
WITH (security_invoker = true)
AS
WITH phase_state AS (
  SELECT
    lp.id,
    lp.product_id,
    lp.cycle,
    lp.phase,
    lp.state,
    lp.entered_at,
    p.risk_tier,
    public.lifecycle_phase_index(lp.phase) AS phase_index,
    cardinality(ARRAY(
      SELECT r
      FROM unnest(public.lifecycle_required_artifacts(lp.phase, p.risk_tier)) AS r
      WHERE NOT EXISTS (
        SELECT 1 FROM public.phase_artifacts pa
        WHERE pa.phase_id = lp.id AND pa.artifact_type = r
      )
    )) AS missing_count
  FROM public.product_lifecycle_phases lp
  JOIN public.products p ON p.id = lp.product_id
  WHERE lp.cycle = (
    SELECT max(c.cycle) FROM public.product_lifecycle_phases c
    WHERE c.product_id = lp.product_id
  )
),
-- "Where is it now": a blocked phase outranks an in-progress one, since that
-- is the thing needing attention; otherwise the earliest unfinished phase.
current_phase AS (
  SELECT DISTINCT ON (product_id)
    product_id, cycle, phase, state, entered_at
  FROM phase_state
  ORDER BY
    product_id,
    CASE state
      WHEN 'blocked'     THEN 0
      WHEN 'in_progress' THEN 1
      WHEN 'not_started' THEN 2
      ELSE 3
    END,
    phase_index
)
SELECT
  p.id AS product_id,
  p.name,
  p.slug,
  p.stage,
  p.risk_tier,
  p.owner_id,
  tm.display_name AS owner_name,
  p.archived_at,
  cp.cycle,
  cp.phase AS current_phase,
  cp.state AS current_state,
  cp.entered_at AS current_phase_entered_at,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(cp.entered_at, p.created_at))) / 86400)::int
    AS days_in_current_phase,
  (SELECT count(*)::int FROM phase_state ps
   WHERE ps.product_id = p.id AND ps.state = 'complete') AS phases_complete,
  (SELECT coalesce(sum(ps.missing_count), 0)::int FROM phase_state ps
   WHERE ps.product_id = p.id) AS missing_required_count,
  (SELECT bool_or(ps.state = 'blocked') FROM phase_state ps
   WHERE ps.product_id = p.id) AS is_blocked
FROM public.products p
LEFT JOIN public.team_members tm ON tm.user_id = p.owner_id
LEFT JOIN current_phase cp ON cp.product_id = p.id;

GRANT SELECT ON public.product_lifecycle_overview TO authenticated;

-- ============================================================
-- product_overview — append lifecycle columns
-- ============================================================
-- Lets dashboard cards render the compact bar without a second round trip.
-- Only appends columns, so existing consumers are untouched.

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
  GREATEST(0::numeric, EXTRACT(epoch FROM now() - COALESCE(p.last_status_update_at, p.created_at)) / 86400::numeric)::integer AS staleness_days,
  lu.summary AS last_update_summary,
  lu.author_name AS last_update_author,
  (SELECT count(*)::integer
     FROM public.product_trends pt
    WHERE pt.product_id = p.id
      AND pt.dismissed_at IS NULL
      AND pt.created_at > (now() - '7 days'::interval)) AS trend_count_7d,
  p.logo_url,
  p.risk_tier,
  lc.phase AS lifecycle_phase,
  lc.state AS lifecycle_state,
  COALESCE(lc.complete_count, 0) AS lifecycle_complete_count
FROM public.products p
LEFT JOIN public.team_members tm ON tm.user_id = p.owner_id
LEFT JOIN LATERAL (
  SELECT su.summary, tum.display_name AS author_name
  FROM public.status_updates su
  LEFT JOIN public.team_members tum ON tum.user_id = su.author_id
  WHERE su.product_id = p.id
  ORDER BY su.created_at DESC
  LIMIT 1
) lu ON true
LEFT JOIN LATERAL (
  SELECT
    (array_agg(lp.phase ORDER BY
      CASE lp.state
        WHEN 'blocked'     THEN 0
        WHEN 'in_progress' THEN 1
        WHEN 'not_started' THEN 2
        ELSE 3
      END,
      public.lifecycle_phase_index(lp.phase)))[1] AS phase,
    (array_agg(lp.state ORDER BY
      CASE lp.state
        WHEN 'blocked'     THEN 0
        WHEN 'in_progress' THEN 1
        WHEN 'not_started' THEN 2
        ELSE 3
      END,
      public.lifecycle_phase_index(lp.phase)))[1] AS state,
    count(*) FILTER (WHERE lp.state = 'complete')::integer AS complete_count
  FROM public.product_lifecycle_phases lp
  WHERE lp.product_id = p.id
    AND lp.cycle = (
      SELECT max(c.cycle) FROM public.product_lifecycle_phases c
      WHERE c.product_id = p.id
    )
) lc ON true;

GRANT SELECT ON public.product_overview TO authenticated;
