-- Release 0.3 — retire the product lifecycle; the release loop replaces it.
--
-- The six-phase product lifecycle (Ideation → Monitor) is replaced by the
-- business track (Idea → Board, on the product) and the release loop (six stages,
-- on each release). Nothing new writes to the lifecycle tables after this
-- migration. They stay as history, read-only, and the lifecycle's gate decisions
-- live on in governance_gate_log as "lifecycle (retired)".
--
-- The data moves in lifecycle_backfill_0_3(). It is one function, so the SQL
-- suite can run it against fixture data, and it is written to be safe to run
-- twice: each step only touches rows it has not handled yet.

-- ============================================================
-- Stop the writers
-- ============================================================

-- New products no longer get lifecycle phases.
DROP TRIGGER IF EXISTS products_seed_lifecycle ON public.products;

-- Artifacts are filed against a release now. Existing rows stay readable.
REVOKE INSERT, DELETE ON public.phase_artifacts FROM authenticated;

-- The two write functions remain, so an old client gets a clear answer rather
-- than "function does not exist".
CREATE OR REPLACE FUNCTION public.advance_lifecycle_phase(
  p_phase_id UUID,
  p_state TEXT,
  p_waiver_reason TEXT DEFAULT NULL
)
RETURNS public.product_lifecycle_phases
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'the product lifecycle is retired; move the release through its stages instead'
    USING ERRCODE = '0A000';
END;
$$;

CREATE OR REPLACE FUNCTION public.set_lifecycle_phase_details(
  p_phase_id UUID,
  p_owner_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.product_lifecycle_phases
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'the product lifecycle is retired; move the release through its stages instead'
    USING ERRCODE = '0A000';
END;
$$;

-- ============================================================
-- Where a product's development stands, by its lifecycle
-- ============================================================
-- The earliest phase that is not complete decides the MVP's stage. Shipped means
-- Monitor is reached: the platform was running, so the MVP is Maintain.

CREATE OR REPLACE FUNCTION public.lifecycle_release_stage(p_product_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH current_phases AS (
    SELECT DISTINCT ON (lp.phase) lp.phase, lp.state
    FROM public.product_lifecycle_phases lp
    WHERE lp.product_id = p_product_id
    ORDER BY lp.phase, lp.cycle DESC
  ),
  earliest AS (
    SELECT cp.phase
    FROM current_phases cp
    WHERE cp.state <> 'complete'
    ORDER BY public.lifecycle_phase_index(cp.phase)
    LIMIT 1
  )
  SELECT CASE (SELECT e.phase FROM earliest e)
    WHEN 'ideation'     THEN 'plan'
    WHEN 'requirements' THEN 'plan'
    WHEN 'plan'         THEN 'design'
    WHEN 'code_test'    THEN 'build'
    WHEN 'deploy'       THEN 'deploy'
    ELSE 'maintain'
  END;
$$;

-- Which release artifact key a retired lifecycle artifact becomes. The artifact
-- type is the primary signal; the phase decides for the generic "other" type.
CREATE OR REPLACE FUNCTION public.lifecycle_artifact_key(p_type TEXT, p_phase TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'concept_brief'         THEN 'intent'
    WHEN 'research_note'         THEN 'intent'
    WHEN 'prd'                   THEN 'intent'
    WHEN 'data_classification'   THEN 'intent'
    WHEN 'threat_model'          THEN 'threat_model'
    WHEN 'design_doc'            THEN 'spec'
    WHEN 'architecture_decision' THEN 'plan'
    WHEN 'psr'                   THEN 'threat_model'
    WHEN 'security_review'       THEN 'security_review'
    WHEN 'test_report'           THEN 'test_results'
    WHEN 'review_evidence'       THEN 'review_findings'
    WHEN 'deploy_checklist'      THEN 'deploy_checklist'
    WHEN 'dast_scan'             THEN 'security_scan'
    WHEN 'pentest_report'        THEN 'security_scan'
    WHEN 'runbook'               THEN 'runbook'
    WHEN 'postmortem'            THEN 'incident'
    WHEN 'metrics_report'        THEN 'metric'
    ELSE CASE p_phase
      WHEN 'ideation'     THEN 'intent'
      WHEN 'requirements' THEN 'intent'
      WHEN 'plan'         THEN 'plan'
      WHEN 'code_test'    THEN 'review_findings'
      WHEN 'deploy'       THEN 'deploy_checklist'
      WHEN 'monitor'      THEN 'runbook'
    END
  END;
$$;

-- ============================================================
-- The backfill
-- ============================================================

CREATE OR REPLACE FUNCTION public.lifecycle_backfill_0_3()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  admin_id UUID;
  prod RECORD;
  rel public.product_releases;
  pa RECORD;
  dev_started BOOLEAN;
  reqs_started BOOLEAN;
  gate_row UUID;
  new_stage TEXT;
  final_status TEXT;
  artifact_key TEXT;
  knowledge_id UUID;
  products_moved INTEGER := 0;
  releases_touched INTEGER := 0;
  artifacts_filed INTEGER := 0;
  artifacts_skipped INTEGER := 0;
BEGIN
  SELECT user_id INTO admin_id
  FROM public.team_members
  WHERE role = 'admin' AND is_active
  ORDER BY created_at, user_id
  LIMIT 1;

  IF admin_id IS NULL THEN
    -- Every backfilled decision is attributed to an admin. With nothing to
    -- attribute, there is nothing to backfill either: a fresh database.
    IF NOT EXISTS (SELECT 1 FROM public.products) THEN
      RETURN 'nothing to backfill';
    END IF;
    RAISE EXCEPTION 'no active admin to attribute the backfill to';
  END IF;

  -- Releases move from status to stage in several steps, some of which the
  -- status-transition trigger would refuse (in_progress → released is not a
  -- move a person makes, but it is the one a shipped MVP needs). The trigger is
  -- back on before this function returns.
  ALTER TABLE public.product_releases DISABLE TRIGGER product_releases_validate;

  -- The tier was added with a default of medium. Every release takes its
  -- product's tier, as a release created from now on will.
  UPDATE public.product_releases r
  SET risk_tier = p.risk_tier
  FROM public.products p
  WHERE p.id = r.product_id
    AND r.release_number IS NULL;

  -- (1) Numbering. The first release a product already has is its MVP.
  UPDATE public.product_releases r
  SET release_number = n.rn - 1
  FROM (
    SELECT id, row_number() OVER (PARTITION BY product_id ORDER BY created_at, id) AS rn
    FROM public.product_releases
  ) n
  WHERE r.id = n.id
    AND r.release_number IS NULL;

  FOR prod IN SELECT p.* FROM public.products p ORDER BY p.created_at, p.id LOOP
    dev_started := EXISTS (
      SELECT 1 FROM public.product_lifecycle_phases lp
      WHERE lp.product_id = prod.id
        AND lp.phase IN ('plan', 'code_test', 'deploy', 'monitor')
        AND lp.state <> 'not_started'
    );

    reqs_started := EXISTS (
      SELECT 1 FROM public.product_lifecycle_phases lp
      WHERE lp.product_id = prod.id
        AND lp.phase = 'requirements'
        AND lp.state <> 'not_started'
    );

    -- (2) Business stage. Development started means Gate 1 was effectively
    -- passed, so the product is in Build with a recorded go. Requirements
    -- started means Concept. Anything else stays at Idea.
    IF NOT EXISTS (
      SELECT 1 FROM public.business_stage_transitions t WHERE t.product_id = prod.id
    ) THEN
      IF dev_started THEN
        INSERT INTO public.product_gate_decisions (product_id, gate, decision, decided_by, note)
        VALUES (prod.id, 1, 'go', admin_id,
                'Backfilled from the 0.2 lifecycle: development had already started.')
        RETURNING id INTO gate_row;

        INSERT INTO public.business_stage_transitions (product_id, from_stage, to_stage, actor_id, reason)
        VALUES (prod.id, 'idea', 'concept', admin_id, 'Backfilled from the 0.2 lifecycle');

        INSERT INTO public.business_stage_transitions (
          product_id, from_stage, to_stage, actor_id, reason, gate_decision_id
        )
        VALUES (prod.id, 'concept', 'build', admin_id, 'Backfilled from the 0.2 lifecycle', gate_row);

        UPDATE public.products SET business_stage = 'build' WHERE id = prod.id;
        products_moved := products_moved + 1;
      ELSIF reqs_started THEN
        INSERT INTO public.business_stage_transitions (product_id, from_stage, to_stage, actor_id, reason)
        VALUES (prod.id, 'idea', 'concept', admin_id, 'Backfilled from the 0.2 lifecycle');

        UPDATE public.products SET business_stage = 'concept' WHERE id = prod.id;
        products_moved := products_moved + 1;
      END IF;
    END IF;

    -- (3) The MVP. Development started and no release exists yet: create it.
    IF dev_started AND NOT EXISTS (
      SELECT 1 FROM public.product_releases r
      WHERE r.product_id = prod.id AND r.release_number = 0
    ) THEN
      INSERT INTO public.product_releases (
        product_id, version, owner_id, created_by, release_number, stage, status, risk_tier
      ) VALUES (
        prod.id, 'MVP', prod.owner_id, admin_id, 0, 'plan', 'planned', prod.risk_tier
      );
    END IF;

    -- (4) Stage and status for every release of the product. Each release is
    -- handled once, marked by the transition row this step writes.
    FOR rel IN
      SELECT r.* FROM public.product_releases r
      WHERE r.product_id = prod.id AND r.release_number IS NOT NULL
      ORDER BY r.release_number
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.release_transitions t
        WHERE t.release_id = rel.id AND t.note = 'Backfilled from the 0.2 lifecycle'
      );

      IF rel.status IN ('cancelled', 'rolled_back') THEN
        new_stage := CASE WHEN rel.status = 'rolled_back' THEN 'maintain' ELSE 'plan' END;
        final_status := rel.status;
      ELSE
        new_stage := CASE
          WHEN rel.release_number = 0 THEN public.lifecycle_release_stage(prod.id)
          ELSE CASE rel.status
            WHEN 'planned'     THEN 'plan'
            WHEN 'in_progress' THEN 'build'
            WHEN 'ready'       THEN 'deploy'
            WHEN 'released'    THEN 'maintain'
          END
        END;
        final_status := public.release_status_for_stage(new_stage);
      END IF;

      UPDATE public.product_releases
      SET stage = new_stage,
          status = final_status,
          released_at = CASE
            WHEN final_status = 'released' THEN coalesce(rel.released_at, rel.created_at)
            WHEN final_status = 'rolled_back' THEN rel.released_at
          END
      WHERE id = rel.id;

      INSERT INTO public.release_transitions (
        release_id, product_id, from_status, to_status, from_stage, to_stage,
        actor_id, risk_tier_at_time, note
      ) VALUES (
        rel.id, prod.id, rel.status, final_status, NULL, new_stage,
        admin_id, rel.risk_tier, 'Backfilled from the 0.2 lifecycle'
      );

      releases_touched := releases_touched + 1;
    END LOOP;
  END LOOP;

  -- (5) Artifacts. Filed against the MVP, mapped to the stage that now owns them.
  -- A lifecycle artifact that was a file is linked through its knowledge mirror,
  -- so the file itself is not copied. One with neither a link nor a mirror has
  -- nothing to point at and is counted, not guessed at.
  FOR pa IN
    SELECT a.id, a.artifact_type, a.title, a.url, a.knowledge_item_id, a.created_at,
           a.uploader_id, lp.phase AS lifecycle_phase, lp.product_id, r.id AS release_id
    FROM public.phase_artifacts a
    JOIN public.product_lifecycle_phases lp ON lp.id = a.phase_id
    JOIN public.product_releases r
      ON r.product_id = lp.product_id AND r.release_number = 0
    ORDER BY a.created_at, a.id
  LOOP
    knowledge_id := coalesce(
      pa.knowledge_item_id,
      (SELECT ki.id FROM public.knowledge_items ki WHERE ki.source_artifact_id = pa.id)
    );

    IF pa.url IS NULL AND knowledge_id IS NULL THEN
      artifacts_skipped := artifacts_skipped + 1;
      CONTINUE;
    END IF;

    artifact_key := public.lifecycle_artifact_key(pa.artifact_type, pa.lifecycle_phase);

    IF EXISTS (
      SELECT 1 FROM public.release_artifacts ra
      WHERE ra.release_id = pa.release_id
        AND ra.title = pa.title
        AND ra.created_at = pa.created_at
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.release_artifacts (
      release_id, stage, artifact_key, title, url, knowledge_item_id, created_by, created_at
    ) VALUES (
      pa.release_id, public.release_artifact_stage(artifact_key), artifact_key,
      pa.title, pa.url, knowledge_id, pa.uploader_id, pa.created_at
    );

    artifacts_filed := artifacts_filed + 1;
  END LOOP;

  -- (6) Knowledge that came from a lifecycle artifact is development material.
  UPDATE public.knowledge_item_products kip
  SET track = 'development'
  FROM public.knowledge_items ki
  WHERE ki.id = kip.item_id
    AND ki.source_artifact_id IS NOT NULL
    AND kip.track IS NULL;

  -- (7) An open task filed under a lifecycle phase now belongs to the MVP. The
  -- phase column stays, unused.
  UPDATE public.product_tasks t
  SET release_id = r.id
  FROM public.product_releases r
  WHERE r.product_id = t.product_id
    AND r.release_number = 0
    AND t.status = 'pending'
    AND t.lifecycle_phase IS NOT NULL
    AND t.release_id IS NULL;

  -- (8) Lifecycle proposals an agent has not had decided can no longer be
  -- applied. Expire them rather than leave a button that does nothing.
  UPDATE public.agent_proposals
  SET status = 'expired'
  WHERE action = 'lifecycle_advance' AND status = 'pending';

  ALTER TABLE public.product_releases ENABLE TRIGGER product_releases_validate;

  RETURN format(
    'products moved: %s; releases handled: %s; artifacts filed: %s; artifacts without a link: %s',
    products_moved, releases_touched, artifacts_filed, artifacts_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lifecycle_backfill_0_3() FROM PUBLIC, anon, authenticated;

-- Runs once, here. The function stays so the SQL suite can exercise it on fixture
-- data; no client role can call it.
SELECT public.lifecycle_backfill_0_3();

-- ============================================================
-- Tighten what the backfill made true
-- ============================================================

ALTER TABLE public.product_releases
  ALTER COLUMN release_number SET NOT NULL;

-- A release's status is its stage's status, except that cancelled and rolled
-- back are set on purpose and sit outside the mapping. This makes a
-- disagreement between the two a write error rather than a silent drift.
ALTER TABLE public.product_releases
  ADD CONSTRAINT product_releases_status_matches_stage CHECK (
    status IN ('cancelled', 'rolled_back')
    OR status = public.release_status_for_stage(stage)
  );
