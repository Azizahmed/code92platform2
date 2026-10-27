-- Release 0.3 — the development track: one loop for every release.
--
-- Release 0 is the MVP. It is created when Gate 1 passes. Release 1, 2, … are
-- cycles, created by hand. Every release runs the same six stages — Plan,
-- Design, Build, Test, Deploy, Maintain — and a stage closes only once the
-- artifacts that prove it are filed. The difference between Release 0 and a
-- cycle is the artifact policy, not the process.
--
-- Stage moves are manual in 0.3: each one is logged with its actor, the
-- artifacts that closed the stage, and what was missing. 0.4 replaces the manual
-- move with git events.
--
-- product_releases.status stays, because release_overview, the MCP tools and the
-- assistant read it. From 0.3 it is derived from the stage (see
-- release_status_for_stage), and only move_release_stage() and
-- advance_release_status() write it.

-- ============================================================
-- Vocabulary
-- ============================================================
-- Authoritative here, mirrored in lib/releases.ts. Change both together.

CREATE OR REPLACE FUNCTION public.release_stage_index(p_stage TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'plan'     THEN 1
    WHEN 'design'   THEN 2
    WHEN 'build'    THEN 3
    WHEN 'test'     THEN 4
    WHEN 'deploy'   THEN 5
    WHEN 'maintain' THEN 6
  END;
$$;

CREATE OR REPLACE FUNCTION public.release_stage_at(p_index INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_index
    WHEN 1 THEN 'plan'
    WHEN 2 THEN 'design'
    WHEN 3 THEN 'build'
    WHEN 4 THEN 'test'
    WHEN 5 THEN 'deploy'
    WHEN 6 THEN 'maintain'
  END;
$$;

-- The status a release shows while it sits in a stage. Entering Deploy means
-- Test has closed and the release is ready to ship; entering Maintain means it
-- has shipped. rolled_back and cancelled are set by advance_release_status() and
-- sit outside this mapping.
CREATE OR REPLACE FUNCTION public.release_status_for_stage(p_stage TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'plan'     THEN 'planned'
    WHEN 'design'   THEN 'in_progress'
    WHEN 'build'    THEN 'in_progress'
    WHEN 'test'     THEN 'in_progress'
    WHEN 'deploy'   THEN 'ready'
    WHEN 'maintain' THEN 'released'
  END;
$$;

-- Every artifact key, and the stage that closes with it. A key belongs to
-- exactly one stage, which is what lets a CHECK on release_artifacts enforce it.
CREATE OR REPLACE FUNCTION public.release_artifact_stage(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_key
    WHEN 'intent'           THEN 'plan'
    WHEN 'spec'             THEN 'design'
    WHEN 'plan'             THEN 'design'
    WHEN 'threat_model'     THEN 'design'
    WHEN 'pull_request'     THEN 'build'
    WHEN 'test_results'     THEN 'test'
    WHEN 'review_findings'  THEN 'test'
    WHEN 'security_review'  THEN 'test'
    WHEN 'release_tag'      THEN 'deploy'
    WHEN 'deploy_checklist' THEN 'deploy'
    WHEN 'security_scan'    THEN 'deploy'
    WHEN 'incident'         THEN 'maintain'
    WHEN 'metric'           THEN 'maintain'
    WHEN 'runbook'          THEN 'maintain'
  END;
$$;

-- ============================================================
-- product_releases: the loop's columns
-- ============================================================

ALTER TABLE public.product_releases
  -- 0 is the MVP; 1, 2, … are cycles in creation order. Assigned by trigger.
  ADD COLUMN release_number INTEGER CHECK (release_number >= 0),
  ADD COLUMN goal TEXT
    CHECK (goal IS NULL OR char_length(btrim(goal)) BETWEEN 1 AND 240),
  ADD COLUMN success_criteria TEXT
    CHECK (success_criteria IS NULL OR char_length(success_criteria) <= 5000),
  ADD COLUMN stage TEXT NOT NULL DEFAULT 'plan'
    CHECK (stage IN ('plan', 'design', 'build', 'test', 'deploy', 'maintain')),
  ADD COLUMN risk_tier TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_tier IN ('low', 'medium', 'high')),
  ADD COLUMN spec_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN spec_approved_at TIMESTAMPTZ,
  ADD COLUMN spec_self_approved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN test_result TEXT CHECK (test_result IS NULL OR test_result IN ('pass', 'fail')),
  ADD COLUMN findings_open INTEGER NOT NULL DEFAULT 0 CHECK (findings_open >= 0),
  ADD COLUMN findings_closed INTEGER NOT NULL DEFAULT 0 CHECK (findings_closed >= 0),
  ADD CONSTRAINT product_releases_spec_approval_complete CHECK (
    (spec_approved_at IS NULL) = (spec_approved_by IS NULL)
  );

-- release_number is unique per product. Two products may both have a Release 0.
-- It is nullable until the lifecycle backfill numbers the existing rows.
CREATE UNIQUE INDEX product_releases_product_number_key
ON public.product_releases (product_id, release_number);

CREATE INDEX product_releases_stage_idx
ON public.product_releases (stage, target_date);

-- The tier is copied from the product at creation and is admin-only after that.
-- release_number is assigned here and never by a client.
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
  NEW.goal := nullif(btrim(coalesce(NEW.goal, '')), '');
  NEW.success_criteria := nullif(btrim(coalesce(NEW.success_criteria, '')), '');

  IF TG_OP = 'INSERT' THEN
    SELECT p.risk_tier INTO NEW.risk_tier
    FROM public.products p WHERE p.id = NEW.product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
    END IF;

    IF NEW.release_number IS NULL THEN
      SELECT coalesce(max(r.release_number), -1) + 1 INTO NEW.release_number
      FROM public.product_releases r
      WHERE r.product_id = NEW.product_id;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.release_number IS DISTINCT FROM OLD.release_number THEN
    RAISE EXCEPTION 'release product, number and creator are immutable';
  END IF;

  IF NEW.risk_tier IS DISTINCT FROM OLD.risk_tier AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only admins can change a release risk tier';
  END IF;

  -- Status moves only through move_release_stage() and advance_release_status(),
  -- both SECURITY DEFINER. This is the backstop for any future writer.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.release_status_can_follow(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'a release cannot move from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

-- Releases are created through create_cycle_release() and start_development()
-- only. A direct INSERT could create a second Release 0 without passing Gate 1.
DROP POLICY "owner or admin creates releases" ON public.product_releases;
REVOKE INSERT ON public.product_releases FROM authenticated;

GRANT UPDATE (goal, success_criteria, risk_tier)
ON public.product_releases TO authenticated;

-- ============================================================
-- Artifact policy: which artifacts a release tier requires
-- ============================================================
-- Admins edit the matrix from Governance. A release snapshots the row it needs
-- when it is created, so editing the policy later does not move the goalposts
-- for work already in flight. Same rule as release_checks.

CREATE TABLE public.release_artifact_policy (
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  kind TEXT NOT NULL CHECK (kind IN ('mvp', 'cycle')),
  artifact_key TEXT NOT NULL CHECK (artifact_key IN (
    'intent', 'spec', 'plan', 'threat_model', 'pull_request',
    'test_results', 'review_findings', 'security_review',
    'release_tag', 'deploy_checklist', 'security_scan',
    'incident', 'metric', 'runbook'
  )),
  is_required BOOLEAN NOT NULL,
  PRIMARY KEY (risk_tier, kind, artifact_key)
);

ALTER TABLE public.release_artifact_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read artifact policy"
ON public.release_artifact_policy FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "admins edit artifact policy"
ON public.release_artifact_policy FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

REVOKE ALL ON public.release_artifact_policy FROM anon, authenticated;
GRANT SELECT ON public.release_artifact_policy TO authenticated;
GRANT UPDATE (is_required) ON public.release_artifact_policy TO authenticated;

-- The defaults. Low risk asks for the least, high risk adds threat modelling and
-- a security review to the MVP. A cycle needs the release notes and the build
-- evidence, and nothing a first release needs on top.
WITH required(risk_tier, kind, artifact_key) AS (
  VALUES
    ('low', 'mvp', 'intent'), ('low', 'mvp', 'spec'), ('low', 'mvp', 'pull_request'),
    ('low', 'mvp', 'test_results'), ('low', 'mvp', 'release_tag'),
    ('low', 'cycle', 'intent'), ('low', 'cycle', 'pull_request'), ('low', 'cycle', 'release_tag'),
    ('medium', 'mvp', 'intent'), ('medium', 'mvp', 'spec'), ('medium', 'mvp', 'pull_request'),
    ('medium', 'mvp', 'test_results'), ('medium', 'mvp', 'release_tag'), ('medium', 'mvp', 'plan'),
    ('medium', 'mvp', 'review_findings'), ('medium', 'mvp', 'deploy_checklist'),
    ('medium', 'cycle', 'intent'), ('medium', 'cycle', 'spec'), ('medium', 'cycle', 'pull_request'),
    ('medium', 'cycle', 'test_results'), ('medium', 'cycle', 'release_tag'),
    ('high', 'mvp', 'intent'), ('high', 'mvp', 'spec'), ('high', 'mvp', 'pull_request'),
    ('high', 'mvp', 'test_results'), ('high', 'mvp', 'release_tag'), ('high', 'mvp', 'plan'),
    ('high', 'mvp', 'review_findings'), ('high', 'mvp', 'deploy_checklist'),
    ('high', 'mvp', 'threat_model'), ('high', 'mvp', 'security_review'),
    ('high', 'cycle', 'intent'), ('high', 'cycle', 'spec'), ('high', 'cycle', 'pull_request'),
    ('high', 'cycle', 'test_results'), ('high', 'cycle', 'release_tag'),
    ('high', 'cycle', 'review_findings')
),
keys(artifact_key) AS (
  VALUES
    ('intent'), ('spec'), ('plan'), ('threat_model'), ('pull_request'),
    ('test_results'), ('review_findings'), ('security_review'),
    ('release_tag'), ('deploy_checklist'), ('security_scan'),
    ('incident'), ('metric'), ('runbook')
)
INSERT INTO public.release_artifact_policy (risk_tier, kind, artifact_key, is_required)
SELECT t.risk_tier, kd.kind, k.artifact_key,
       EXISTS (
         SELECT 1 FROM required r
         WHERE r.risk_tier = t.risk_tier
           AND r.kind = kd.kind
           AND r.artifact_key = k.artifact_key
       )
FROM (VALUES ('low'), ('medium'), ('high')) AS t(risk_tier)
CROSS JOIN (VALUES ('mvp'), ('cycle')) AS kd(kind)
CROSS JOIN keys k;

-- ============================================================
-- release_artifact_requirements: the snapshot
-- ============================================================

CREATE TABLE public.release_artifact_requirements (
  release_id UUID NOT NULL
    REFERENCES public.product_releases(id) ON DELETE CASCADE,
  artifact_key TEXT NOT NULL,
  is_required BOOLEAN NOT NULL,
  PRIMARY KEY (release_id, artifact_key)
);

ALTER TABLE public.release_artifact_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read artifact requirements"
ON public.release_artifact_requirements FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.release_artifact_requirements FROM anon, authenticated;
GRANT SELECT ON public.release_artifact_requirements TO authenticated;

CREATE OR REPLACE FUNCTION public.releases_seed_artifact_requirements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.release_artifact_requirements (release_id, artifact_key, is_required)
  SELECT NEW.id, p.artifact_key, p.is_required
  FROM public.release_artifact_policy p
  WHERE p.risk_tier = NEW.risk_tier
    AND p.kind = CASE WHEN NEW.release_number = 0 THEN 'mvp' ELSE 'cycle' END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_releases_seed_artifact_requirements
AFTER INSERT ON public.product_releases
FOR EACH ROW EXECUTE FUNCTION public.releases_seed_artifact_requirements();

-- The release checklist is seeded from the release's own tier now, not the
-- product's current one, for the same reason as above.
CREATE OR REPLACE FUNCTION public.releases_seed_checks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.release_checks (release_id, check_key, is_required)
  SELECT NEW.id, k, true
  FROM unnest(public.release_required_checks(NEW.risk_tier)) AS k;

  RETURN NEW;
END;
$$;

-- ============================================================
-- release_artifacts
-- ============================================================
-- A link to the evidence: a URL in the product's repository or elsewhere, or a
-- Knowledge item (lifecycle artifacts that were files are linked this way). The
-- platform records what was filed, not what it contains.

CREATE TABLE public.release_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL
    REFERENCES public.product_releases(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('plan', 'design', 'build', 'test', 'deploy', 'maintain')),
  artifact_key TEXT NOT NULL CHECK (artifact_key IN (
    'intent', 'spec', 'plan', 'threat_model', 'pull_request',
    'test_results', 'review_findings', 'security_review',
    'release_tag', 'deploy_checklist', 'security_scan',
    'incident', 'metric', 'runbook'
  )),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  url TEXT CHECK (url IS NULL OR url ~ '^https?://'),
  knowledge_item_id UUID REFERENCES public.knowledge_items(id) ON DELETE SET NULL,
  commit_ref TEXT CHECK (commit_ref IS NULL OR char_length(btrim(commit_ref)) BETWEEN 1 AND 100),
  -- Incidents, metrics and runbooks seed the next release's intent.
  carry_to_next BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT release_artifacts_has_location CHECK (
    url IS NOT NULL OR knowledge_item_id IS NOT NULL
  ),
  CONSTRAINT release_artifacts_stage_matches_key CHECK (
    stage = public.release_artifact_stage(artifact_key)
  ),
  CONSTRAINT release_artifacts_carry_keys CHECK (
    NOT carry_to_next OR artifact_key IN ('incident', 'metric', 'runbook')
  )
);

CREATE INDEX release_artifacts_release_stage_idx
ON public.release_artifacts (release_id, stage);

ALTER TABLE public.release_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read release artifacts"
ON public.release_artifacts FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.release_artifacts FROM anon, authenticated;
GRANT SELECT ON public.release_artifacts TO authenticated;

-- ============================================================
-- Who may manage a release (defined after the table it reads)
-- ============================================================
-- can_manage_release() is defined in the release-management migration; it is
-- the owner-or-admin rule, reused here unchanged.

-- ============================================================
-- Release 0 and cycles
-- ============================================================

-- Gate 1 calls this. Idempotent: a product that already has a Release 0 keeps it.
CREATE OR REPLACE FUNCTION public.start_development(p_product_id UUID)
RETURNS public.product_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  prod public.products;
  result public.product_releases;
BEGIN
  SELECT * INTO result
  FROM public.product_releases
  WHERE product_id = p_product_id AND release_number = 0;

  IF FOUND THEN
    RETURN result;
  END IF;

  SELECT * INTO prod FROM public.products WHERE id = p_product_id;

  INSERT INTO public.product_releases (
    product_id, version, owner_id, created_by, release_number, stage, status
  ) VALUES (
    p_product_id, 'MVP', prod.owner_id, (SELECT auth.uid()), 0, 'plan', 'planned'
  )
  RETURNING * INTO result;

  INSERT INTO public.release_transitions (
    release_id, product_id, from_status, to_status, from_stage, to_stage,
    actor_id, risk_tier_at_time, note
  ) VALUES (
    result.id, p_product_id, NULL, 'planned', NULL, 'plan',
    (SELECT auth.uid()), result.risk_tier,
    'Release 0 created when Gate 1 passed'
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.start_development(UUID) FROM PUBLIC, anon, authenticated;

-- A cycle needs the development track open, which means Gate 1 has passed.
CREATE OR REPLACE FUNCTION public.create_cycle_release(
  p_product_id UUID,
  p_version TEXT,
  p_goal TEXT,
  p_target_date DATE DEFAULT NULL,
  p_success_criteria TEXT DEFAULT NULL
)
RETURNS public.product_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  prod public.products;
  result public.product_releases;
BEGIN
  IF NOT public.can_manage_release_for_product(p_product_id) THEN
    RAISE EXCEPTION 'only the product owner or an admin can create a release'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prod FROM public.products WHERE id = p_product_id;

  IF public.business_stage_index(prod.business_stage) < public.business_stage_index('build') THEN
    RAISE EXCEPTION
      'a cycle needs Gate 1 passed: the product is in % (Build or later)', prod.business_stage
      USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(p_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a version is required' USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(p_goal, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a one-line goal is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.product_releases (
    product_id, version, goal, success_criteria, target_date, owner_id, created_by
  ) VALUES (
    p_product_id, p_version, p_goal, p_success_criteria, p_target_date,
    prod.owner_id, (SELECT auth.uid())
  )
  RETURNING * INTO result;

  INSERT INTO public.release_transitions (
    release_id, product_id, from_status, to_status, from_stage, to_stage,
    actor_id, risk_tier_at_time, note
  ) VALUES (
    result.id, p_product_id, NULL, 'planned', NULL, 'plan',
    (SELECT auth.uid()), result.risk_tier, 'Cycle created'
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_cycle_release(UUID, TEXT, TEXT, DATE, TEXT)
TO authenticated;

-- ============================================================
-- Gaps: what stands between a release and closing its current stage
-- ============================================================
-- One source of truth for both move_release_stage() and my_waiting_on(), so the
-- list of what is ready and the move that succeeds can never disagree.
--
-- Gap keys: 'link' (no artifact filed at this stage), an artifact key the
-- snapshot requires, 'spec_approval', 'test_pass', 'findings_closed', a release
-- check key, and 'open_tasks'. The last two groups are waivable for high risk;
-- the rest are not.

CREATE OR REPLACE FUNCTION public.release_stage_gaps(p_release_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  rel public.product_releases;
  gaps TEXT[] := ARRAY[]::TEXT[];
  item TEXT;
BEGIN
  SELECT * INTO rel FROM public.product_releases WHERE id = p_release_id;
  IF NOT FOUND OR rel.stage = 'maintain' THEN
    RETURN gaps;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.release_artifacts a
    WHERE a.release_id = rel.id AND a.stage = rel.stage
  ) THEN
    gaps := array_append(gaps, 'link');
  END IF;

  FOR item IN
    SELECT r.artifact_key
    FROM public.release_artifact_requirements r
    WHERE r.release_id = rel.id
      AND r.is_required
      AND public.release_artifact_stage(r.artifact_key) = rel.stage
    ORDER BY r.artifact_key
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.release_artifacts a
      WHERE a.release_id = rel.id AND a.artifact_key = item
    ) THEN
      gaps := array_append(gaps, item);
    END IF;
  END LOOP;

  IF rel.stage = 'design' AND rel.spec_approved_at IS NULL AND EXISTS (
    SELECT 1 FROM public.release_artifact_requirements r
    WHERE r.release_id = rel.id AND r.artifact_key = 'spec' AND r.is_required
  ) THEN
    gaps := array_append(gaps, 'spec_approval');
  END IF;

  IF rel.stage = 'test' THEN
    IF rel.test_result IS DISTINCT FROM 'pass' THEN
      gaps := array_append(gaps, 'test_pass');
    END IF;
    IF rel.findings_open > 0 THEN
      gaps := array_append(gaps, 'findings_closed');
    END IF;
  END IF;

  IF rel.stage = 'deploy' THEN
    FOR item IN
      SELECT c.check_key
      FROM public.release_checks c
      WHERE c.release_id = rel.id AND c.is_required AND c.completed_at IS NULL
      ORDER BY c.check_key
    LOOP
      gaps := array_append(gaps, item);
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM public.product_tasks t
      WHERE t.release_id = rel.id AND t.status <> 'completed'
    ) THEN
      gaps := array_append(gaps, 'open_tasks');
    END IF;
  END IF;

  RETURN gaps;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stage_gaps(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_stage_gaps(UUID) TO authenticated;

-- ============================================================
-- Artifacts: filing and removing evidence
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_release_artifact(
  p_release_id UUID,
  p_key TEXT,
  p_title TEXT,
  p_url TEXT,
  p_commit_ref TEXT DEFAULT NULL,
  p_carry_to_next BOOLEAN DEFAULT false
)
RETURNS public.release_artifacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  rel public.product_releases;
  artifact_stage TEXT;
  result public.release_artifacts;
BEGIN
  IF NOT public.can_manage_release(p_release_id) THEN
    RAISE EXCEPTION 'only the product owner or an admin can file release artifacts'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO rel FROM public.product_releases WHERE id = p_release_id;

  IF rel.status = 'cancelled' THEN
    RAISE EXCEPTION 'a cancelled release takes no new artifacts' USING ERRCODE = '22023';
  END IF;

  artifact_stage := public.release_artifact_stage(p_key);
  IF artifact_stage IS NULL THEN
    RAISE EXCEPTION 'unknown artifact key %', p_key USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(p_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a link is required for a release artifact' USING ERRCODE = '22023';
  END IF;

  -- Evidence for a stage the release has not reached cannot exist yet.
  IF public.release_stage_index(artifact_stage) > public.release_stage_index(rel.stage) THEN
    RAISE EXCEPTION '% belongs to %, which the release has not reached yet (it is in %)',
      p_key, artifact_stage, rel.stage USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.release_artifacts (
    release_id, stage, artifact_key, title, url, commit_ref, carry_to_next
  ) VALUES (
    p_release_id, artifact_stage, p_key, p_title,
    nullif(btrim(coalesce(p_url, '')), ''),
    nullif(btrim(coalesce(p_commit_ref, '')), ''),
    coalesce(p_carry_to_next, false)
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_release_artifact(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
TO authenticated;

-- Only the current stage's artifacts can be taken back. Earlier stages are
-- closed, and their evidence is part of the record.
CREATE OR REPLACE FUNCTION public.remove_release_artifact(p_artifact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  artifact public.release_artifacts;
  rel public.product_releases;
BEGIN
  SELECT * INTO artifact FROM public.release_artifacts WHERE id = p_artifact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'artifact not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_release(artifact.release_id) THEN
    RAISE EXCEPTION 'only the product owner or an admin can remove release artifacts'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO rel FROM public.product_releases WHERE id = artifact.release_id;

  IF artifact.stage <> rel.stage THEN
    RAISE EXCEPTION 'only artifacts of the current stage (%) can be removed', rel.stage
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.release_artifacts WHERE id = p_artifact_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_release_artifact(UUID) TO authenticated;

-- ============================================================
-- release_transitions: the loop's audit fields
-- ============================================================

ALTER TABLE public.release_transitions
  ADD COLUMN from_stage TEXT CHECK (from_stage IS NULL OR from_stage IN
    ('plan', 'design', 'build', 'test', 'deploy', 'maintain')),
  ADD COLUMN to_stage TEXT CHECK (to_stage IS NULL OR to_stage IN
    ('plan', 'design', 'build', 'test', 'deploy', 'maintain')),
  ADD COLUMN missing_artifacts TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN artifact_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN note TEXT CHECK (note IS NULL OR char_length(note) <= 2000);

-- ============================================================
-- move_release_stage — the only writer of a release's stage
-- ============================================================

CREATE OR REPLACE FUNCTION public.move_release_stage(
  p_release_id UUID,
  p_to_stage TEXT,
  p_note TEXT DEFAULT NULL
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
  admin BOOLEAN := public.is_admin();
  is_owner BOOLEAN;
  note TEXT := nullif(btrim(coalesce(p_note, '')), '');
  from_index INTEGER;
  to_index INTEGER;
  gaps TEXT[] := ARRAY[]::TEXT[];
  artifact_gaps TEXT[];
  check_gaps TEXT[];
  closing_ids UUID[] := ARRAY[]::UUID[];
  result public.product_releases;
BEGIN
  IF NOT public.can_manage_release(p_release_id) THEN
    RAISE EXCEPTION 'only the product owner or an admin can move a release'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO rel FROM public.product_releases WHERE id = p_release_id FOR UPDATE;
  SELECT * INTO prod FROM public.products WHERE id = rel.product_id;
  is_owner := prod.owner_id = actor;

  IF prod.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot change a release of an archived product' USING ERRCODE = '22023';
  END IF;

  -- Same rule as advance_release_status: high-risk releases are admin-only.
  IF rel.risk_tier = 'high' AND NOT admin THEN
    RAISE EXCEPTION 'high-risk releases need an admin to move stage' USING ERRCODE = '42501';
  END IF;

  IF rel.status = 'cancelled' THEN
    RAISE EXCEPTION 'release is cancelled; re-plan it first' USING ERRCODE = '22023';
  END IF;

  IF rel.status = 'rolled_back' THEN
    RAISE EXCEPTION 'release was rolled back; reopen it first' USING ERRCODE = '22023';
  END IF;

  from_index := public.release_stage_index(rel.stage);
  to_index := public.release_stage_index(p_to_stage);

  IF to_index IS NULL THEN
    RAISE EXCEPTION 'unknown release stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  IF to_index = from_index THEN
    RAISE EXCEPTION 'release is already in stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  IF to_index > from_index + 1 THEN
    RAISE EXCEPTION 'move one stage at a time: % comes next',
      public.release_stage_at(from_index + 1) USING ERRCODE = '22023';
  END IF;

  IF to_index < from_index THEN
    IF note IS NULL THEN
      RAISE EXCEPTION 'a note is required to move a release backward' USING ERRCODE = '22023';
    END IF;
    IF rel.status = 'released' THEN
      RAISE EXCEPTION 'a shipped release cannot move back; roll it back instead'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF to_index > from_index THEN
    gaps := public.release_stage_gaps(rel.id);

    -- Waivable gaps are the release checks and open tasks, and only at Deploy.
    SELECT coalesce(array_agg(g ORDER BY g), ARRAY[]::TEXT[]) INTO check_gaps
    FROM unnest(gaps) AS g
    WHERE g IN ('release_notes', 'qa_signoff', 'rollback_plan',
                'security_signoff', 'change_approval', 'open_tasks');

    SELECT coalesce(array_agg(g ORDER BY g), ARRAY[]::TEXT[]) INTO artifact_gaps
    FROM unnest(gaps) AS g
    WHERE g <> ALL (check_gaps);

    IF cardinality(artifact_gaps) > 0 THEN
      RAISE EXCEPTION 'cannot close % yet; missing: %',
        rel.stage, array_to_string(artifact_gaps, ', ') USING ERRCODE = '22023';
    END IF;

    IF rel.stage = 'deploy' AND cardinality(check_gaps) > 0
       AND rel.risk_tier = 'high' AND note IS NULL THEN
      RAISE EXCEPTION 'a waiver reason is required for high-risk releases; unmet: %',
        array_to_string(check_gaps, ', ') USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(array_agg(a.id), ARRAY[]::UUID[]) INTO closing_ids
    FROM public.release_artifacts a
    WHERE a.release_id = rel.id AND a.stage = rel.stage;
  ELSE
    artifact_gaps := ARRAY[]::TEXT[];
    check_gaps := ARRAY[]::TEXT[];
  END IF;

  UPDATE public.product_releases
  SET stage = p_to_stage,
      status = public.release_status_for_stage(p_to_stage),
      released_at = CASE WHEN p_to_stage = 'maintain' THEN now() END
  WHERE id = rel.id
  RETURNING * INTO result;

  INSERT INTO public.release_transitions (
    release_id, product_id, from_status, to_status, from_stage, to_stage,
    actor_id, risk_tier_at_time, missing_checks, missing_artifacts,
    waiver_reason, self_approved, note, artifact_ids
  ) VALUES (
    rel.id, rel.product_id, rel.status, result.status, rel.stage, p_to_stage,
    actor, rel.risk_tier, check_gaps, artifact_gaps,
    CASE WHEN rel.risk_tier = 'high' AND cardinality(check_gaps) > 0 THEN note END,
    p_to_stage = 'maintain' AND is_owner AND admin,
    note, closing_ids
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_release_stage(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- Spec approval and test results
-- ============================================================

-- Approval is recorded on the release and in the log. A self-approval (the
-- release's own owner approving its spec) is flagged, as lifecycle waivers are.
CREATE OR REPLACE FUNCTION public.approve_release_spec(
  p_release_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS public.product_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  rel public.product_releases;
  actor UUID := (SELECT auth.uid());
  result public.product_releases;
BEGIN
  IF NOT public.can_manage_release(p_release_id) THEN
    RAISE EXCEPTION 'only the product owner or an admin can approve a spec'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO rel FROM public.product_releases WHERE id = p_release_id FOR UPDATE;

  IF rel.stage <> 'design' THEN
    RAISE EXCEPTION 'the spec is approved at Design (the release is in %)', rel.stage
      USING ERRCODE = '22023';
  END IF;

  IF rel.spec_approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'the spec is already approved' USING ERRCODE = '22023';
  END IF;

  UPDATE public.product_releases
  SET spec_approved_by = actor,
      spec_approved_at = now(),
      spec_self_approved = (actor = rel.owner_id)
  WHERE id = rel.id
  RETURNING * INTO result;

  INSERT INTO public.release_transitions (
    release_id, product_id, from_status, to_status, from_stage, to_stage,
    actor_id, risk_tier_at_time, self_approved, note
  ) VALUES (
    rel.id, rel.product_id, rel.status, rel.status, 'design', 'design',
    actor, rel.risk_tier, actor = rel.owner_id,
    coalesce(
      nullif(btrim(coalesce(p_note, '')), ''),
      'Spec approved'
    )
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_release_spec(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_release_test_result(
  p_release_id UUID,
  p_result TEXT,
  p_findings_open INTEGER,
  p_findings_closed INTEGER
)
RETURNS public.product_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  rel public.product_releases;
  result public.product_releases;
BEGIN
  IF NOT public.can_manage_release(p_release_id) THEN
    RAISE EXCEPTION 'only the product owner or an admin can record test results'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO rel FROM public.product_releases WHERE id = p_release_id;

  IF rel.stage <> 'test' THEN
    RAISE EXCEPTION 'test results are recorded at Test (the release is in %)', rel.stage
      USING ERRCODE = '22023';
  END IF;

  IF p_result NOT IN ('pass', 'fail') THEN
    RAISE EXCEPTION 'test result must be pass or fail' USING ERRCODE = '22023';
  END IF;

  UPDATE public.product_releases
  SET test_result = p_result,
      findings_open = p_findings_open,
      findings_closed = p_findings_closed
  WHERE id = rel.id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_release_test_result(UUID, TEXT, INTEGER, INTEGER)
TO authenticated;

-- ============================================================
-- advance_release_status — the exits from the loop
-- ============================================================
-- Forward movement is move_release_stage(). This function covers the three
-- things the loop does not: cancelling, rolling back a shipped release, and
-- reopening either of those. Every other status is derived from the stage, so
-- asking for it here is refused.

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
  reason TEXT := nullif(btrim(coalesce(p_waiver_reason, '')), '');
  new_stage TEXT;
  result public.product_releases;
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'only active members can change a release';
  END IF;

  IF public.release_status_index(p_status) IS NULL THEN
    RAISE EXCEPTION 'invalid release status: %', p_status;
  END IF;

  SELECT * INTO rel FROM public.product_releases WHERE id = p_release_id FOR UPDATE;
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

  IF rel.risk_tier = 'high' AND NOT admin THEN
    RAISE EXCEPTION 'high-risk releases need an admin to change a release';
  END IF;

  IF rel.status = p_status THEN
    RETURN rel;
  END IF;

  IF NOT public.release_status_can_follow(rel.status, p_status) THEN
    RAISE EXCEPTION 'a release cannot move from % to %', rel.status, p_status;
  END IF;

  new_stage := rel.stage;

  IF p_status = 'cancelled' THEN
    IF reason IS NULL THEN
      RAISE EXCEPTION 'a reason is required to cancel a release';
    END IF;
  ELSIF p_status = 'rolled_back' THEN
    IF reason IS NULL THEN
      RAISE EXCEPTION 'a reason is required to roll a release back';
    END IF;
  ELSIF p_status = 'planned' AND rel.status = 'cancelled' THEN
    -- A cancelled release that is re-planned starts its loop again.
    new_stage := 'plan';
  ELSIF p_status = 'in_progress' AND rel.status = 'rolled_back' THEN
    -- A rolled-back release is fixed in Build and shipped again.
    new_stage := 'build';
  ELSE
    RAISE EXCEPTION
      '% is set by the stage moves, not directly (use move_release_stage)', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.product_releases
  SET status = p_status,
      stage = new_stage,
      released_at = CASE WHEN p_status = 'rolled_back' THEN released_at END
  WHERE id = rel.id
  RETURNING * INTO result;

  -- A stage is recorded only when it actually changed. Otherwise a cancellation
  -- would read as a stage move, or as a spec approval, in the governance log.
  INSERT INTO public.release_transitions (
    release_id, product_id, from_status, to_status, from_stage, to_stage,
    actor_id, risk_tier_at_time, waiver_reason, note
  ) VALUES (
    rel.id, rel.product_id, rel.status, p_status,
    CASE WHEN new_stage <> rel.stage THEN rel.stage END,
    CASE WHEN new_stage <> rel.stage THEN new_stage END,
    actor, rel.risk_tier, NULL, reason
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_release_status(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- release_overview — the projection every release surface reads
-- ============================================================
-- Recreated rather than replaced: a view cannot drop a column in place, and
-- risk_tier now means the release's own tier, not the product's.

DROP VIEW public.release_overview;

CREATE VIEW public.release_overview
WITH (security_invoker = true)
AS
SELECT
  r.id,
  r.product_id,
  p.name AS product_name,
  p.slug AS product_slug,
  p.logo_url AS product_logo_url,
  p.business_stage AS product_business_stage,
  r.risk_tier,
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
    WHERE t.release_id = r.id AND t.status <> 'completed') AS open_task_count,
  r.release_number,
  (r.release_number = 0) AS is_mvp,
  r.goal,
  r.success_criteria,
  r.stage,
  r.spec_approved_at,
  r.spec_self_approved,
  r.test_result,
  r.findings_open,
  r.findings_closed,
  (SELECT count(*)::int FROM public.release_artifact_requirements q
    WHERE q.release_id = r.id AND q.is_required) AS artifacts_required,
  (SELECT count(DISTINCT a.artifact_key)::int FROM public.release_artifacts a
    JOIN public.release_artifact_requirements q
      ON q.release_id = a.release_id AND q.artifact_key = a.artifact_key
    WHERE a.release_id = r.id AND q.is_required) AS artifacts_filed,
  coalesce(cardinality(public.release_stage_gaps(r.id)), 0) AS stage_gap_count
FROM public.product_releases r
JOIN public.products p ON p.id = r.product_id
LEFT JOIN public.team_members tm ON tm.user_id = r.owner_id;

GRANT SELECT ON public.release_overview TO authenticated;

-- ============================================================
-- knowledge_item_products: track and release
-- ============================================================
-- A product's knowledge is either business (the funnel's documents) or
-- development (the loop's), and a development document can be pinned to one of
-- the product's releases. Links made before 0.3 keep both fields null.

ALTER TABLE public.knowledge_item_products
  ADD COLUMN track TEXT CHECK (track IS NULL OR track IN ('business', 'development')),
  ADD COLUMN release_id UUID REFERENCES public.product_releases(id) ON DELETE SET NULL,
  ADD CONSTRAINT knowledge_item_products_release_is_development CHECK (
    release_id IS NULL OR track = 'development'
  );

CREATE INDEX knowledge_item_products_release_idx
ON public.knowledge_item_products (release_id)
WHERE release_id IS NOT NULL;

-- A link can only be pinned to a release of the product it links to.
CREATE OR REPLACE FUNCTION public.knowledge_item_products_validate_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.release_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_releases r
    WHERE r.id = NEW.release_id AND r.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'a knowledge link can only point at a release of its own product';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_item_products_validate_release
BEFORE INSERT OR UPDATE ON public.knowledge_item_products
FOR EACH ROW EXECUTE FUNCTION public.knowledge_item_products_validate_release();

CREATE POLICY "item editors update knowledge item products"
ON public.knowledge_item_products FOR UPDATE TO authenticated
USING (public.can_edit_knowledge_item(item_id))
WITH CHECK (public.can_edit_knowledge_item(item_id));

GRANT UPDATE (track, release_id) ON public.knowledge_item_products TO authenticated;
