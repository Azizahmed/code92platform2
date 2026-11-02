-- The lifecycle backfill, on data shaped like production before 0.3:
--   Jadawel   — Code & Testing in progress, with filed artifacts and an open task
--   Cliko     — Ideation in progress and nothing else
--   Platform  — Monitor in progress, and one release already recorded as in progress
-- The migration ran the backfill on an empty database. Here it runs again on this
-- data, which also proves it is safe to run twice.

-- ---------- Legacy shape ----------
-- Lifecycle rows, as the old seed trigger wrote them.
INSERT INTO public.product_lifecycle_phases (product_id, phase, state, cycle) VALUES
  ('10000000-0000-4000-8000-000000000001', 'ideation', 'complete', 1),
  ('10000000-0000-4000-8000-000000000001', 'requirements', 'complete', 1),
  ('10000000-0000-4000-8000-000000000001', 'plan', 'complete', 1),
  ('10000000-0000-4000-8000-000000000001', 'code_test', 'in_progress', 1),
  ('10000000-0000-4000-8000-000000000001', 'deploy', 'not_started', 1),
  ('10000000-0000-4000-8000-000000000001', 'monitor', 'not_started', 1),
  ('10000000-0000-4000-8000-000000000002', 'ideation', 'in_progress', 1),
  ('10000000-0000-4000-8000-000000000002', 'requirements', 'not_started', 1),
  ('10000000-0000-4000-8000-000000000002', 'plan', 'not_started', 1),
  ('10000000-0000-4000-8000-000000000002', 'code_test', 'not_started', 1),
  ('10000000-0000-4000-8000-000000000002', 'deploy', 'not_started', 1),
  ('10000000-0000-4000-8000-000000000002', 'monitor', 'not_started', 1);

INSERT INTO public.products (id, name, slug, owner_id)
VALUES ('10000000-0000-4000-8000-0000000000b1', 'Platform', 'platform', test.uid('admin'));
INSERT INTO public.product_lifecycle_phases (product_id, phase, state, cycle) VALUES
  ('10000000-0000-4000-8000-0000000000b1', 'ideation', 'complete', 1),
  ('10000000-0000-4000-8000-0000000000b1', 'requirements', 'complete', 1),
  ('10000000-0000-4000-8000-0000000000b1', 'plan', 'complete', 1),
  ('10000000-0000-4000-8000-0000000000b1', 'code_test', 'complete', 1),
  ('10000000-0000-4000-8000-0000000000b1', 'deploy', 'complete', 1),
  ('10000000-0000-4000-8000-0000000000b1', 'monitor', 'in_progress', 1);

-- Lifecycle artifacts for Jadawel. The DAST scan is a file: the mirror trigger
-- from 0.1's knowledge sync gives it a Knowledge item, and the release artifact
-- links through that item.
INSERT INTO public.phase_artifacts (phase_id, artifact_type, title, url, uploader_id)
SELECT id, 'prd', 'PRD v1', 'https://example.com/prd', test.uid('alice')
FROM public.product_lifecycle_phases
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'requirements';

INSERT INTO public.phase_artifacts (phase_id, artifact_type, title, url, uploader_id)
SELECT id, 'test_report', 'Test report', 'https://example.com/test-report', test.uid('alice')
FROM public.product_lifecycle_phases
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'code_test';

INSERT INTO public.phase_artifacts (phase_id, artifact_type, title, url, uploader_id)
SELECT id, 'other', 'Planning notes', 'https://example.com/plan-notes', test.uid('alice')
FROM public.product_lifecycle_phases
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'plan';

INSERT INTO public.phase_artifacts (phase_id, artifact_type, title, storage_url, storage_key, file_name, mime_type, size_bytes, uploader_id)
SELECT id, 'dast_scan', 'DAST scan', 'https://storage.example.com/lifecycle-artifacts/dast.pdf',
       'lifecycle-artifacts/dast.pdf', 'dast.pdf', 'application/pdf', 1024, test.uid('alice')
FROM public.product_lifecycle_phases
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'deploy';

-- An open task filed under a lifecycle phase.
INSERT INTO public.product_tasks (product_id, title, created_by, lifecycle_phase)
VALUES ('10000000-0000-4000-8000-000000000001', 'Write the runbook', test.uid('alice'), 'monitor');

-- Platform's one existing release: recorded, but never moved past in_progress.
-- The release tables have constraints and triggers that only a current write
-- satisfies, so they are set aside for this insert and put back afterwards.
ALTER TABLE public.product_releases ALTER COLUMN release_number DROP NOT NULL;
ALTER TABLE public.product_releases DROP CONSTRAINT product_releases_status_matches_stage;
ALTER TABLE public.product_releases DISABLE TRIGGER USER;
INSERT INTO public.product_releases (id, product_id, version, status, stage, risk_tier, created_by, created_at)
VALUES ('50000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
        '0.1', 'in_progress', 'plan', 'low', test.uid('admin'), now() - interval '20 days');
ALTER TABLE public.product_releases ENABLE TRIGGER USER;

-- ---------- Run the backfill ----------
SELECT public.lifecycle_backfill_0_3();

-- ---------- Business track ----------
SELECT test.assert_eq(
  (SELECT business_stage FROM public.products WHERE id = '10000000-0000-4000-8000-000000000001'),
  'build', 'development started: Jadawel is in Build');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.product_gate_decisions
          WHERE product_id = '10000000-0000-4000-8000-000000000001' AND gate = 1 AND decision = 'go'
            AND note LIKE 'Backfilled from the 0.2 lifecycle%'),
  'the Gate 1 go it implies is recorded, and says where it came from');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.business_stage_transitions
   WHERE product_id = '10000000-0000-4000-8000-000000000001'),
  2::bigint, 'Jadawel moved Idea → Concept → Build, logged');
SELECT test.assert_eq(
  (SELECT business_stage FROM public.products WHERE id = '10000000-0000-4000-8000-000000000002'),
  'idea', 'ideation only: Cliko stays at Idea');
SELECT test.assert_eq(
  (SELECT business_stage FROM public.products WHERE id = '10000000-0000-4000-8000-0000000000b1'),
  'build', 'Platform had development: it is in Build');

-- ---------- Releases ----------
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.product_releases
          WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0
            AND version = 'MVP' AND stage = 'build' AND status = 'in_progress' AND risk_tier = 'medium'),
  'Jadawel gets an MVP at Build (its earliest unfinished phase is Code & Testing)');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-000000000002'),
  0::bigint, 'Cliko has no release yet');

-- Platform's existing release becomes its MVP, shipped: Monitor is reached.
SELECT test.assert(
  (SELECT release_number = 0 AND stage = 'maintain' AND status = 'released'
     AND released_at IS NOT NULL AND version = '0.1'
   FROM public.product_releases WHERE id = '50000000-0000-4000-8000-0000000000b1'),
  'the first existing release is the MVP, and Monitor makes it shipped');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-0000000000b1'),
  1::bigint, 'no second MVP is invented for Platform');

-- Every release the backfill touched is in the log, marked as backfilled.
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.release_transitions
          WHERE release_id = '50000000-0000-4000-8000-0000000000b1'
            AND from_status = 'in_progress' AND to_status = 'released'
            AND note = 'Backfilled from the 0.2 lifecycle'),
  'the shipping of Platform 0.1 is logged as backfilled');

-- ---------- Artifacts, filed against the MVP and mapped to a stage ----------
SELECT test.assert_eq(
  (SELECT count(*) FROM public.release_artifacts ra
   JOIN public.product_releases r ON r.id = ra.release_id
   WHERE r.product_id = '10000000-0000-4000-8000-000000000001' AND r.release_number = 0),
  4::bigint, 'all four lifecycle artifacts are filed against the MVP');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.release_artifacts ra
          JOIN public.product_releases r ON r.id = ra.release_id
          WHERE r.product_id = '10000000-0000-4000-8000-000000000001' AND r.release_number = 0
            AND ra.artifact_key = 'security_scan' AND ra.stage = 'deploy'
            AND ra.knowledge_item_id IS NOT NULL),
  'a file artifact is linked through its Knowledge item, at Deploy');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.release_artifacts ra
          JOIN public.product_releases r ON r.id = ra.release_id
          WHERE r.product_id = '10000000-0000-4000-8000-000000000001' AND r.release_number = 0
            AND ra.artifact_key = 'intent' AND ra.stage = 'plan'
            AND ra.url = 'https://example.com/prd'),
  'a PRD becomes the intent, at Plan');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.release_artifacts ra
          JOIN public.product_releases r ON r.id = ra.release_id
          WHERE r.product_id = '10000000-0000-4000-8000-000000000001' AND r.release_number = 0
            AND ra.artifact_key = 'test_results' AND ra.stage = 'test'),
  'a test report becomes the test results, at Test');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.release_artifacts ra
          JOIN public.product_releases r ON r.id = ra.release_id
          WHERE r.product_id = '10000000-0000-4000-8000-000000000001' AND r.release_number = 0
            AND ra.artifact_key = 'plan' AND ra.stage = 'design'),
  'a planning note, filed under Plan, becomes the plan, at Design');

-- The open task filed under a phase now belongs to the MVP.
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.product_tasks t
          JOIN public.product_releases r ON r.id = t.release_id
          WHERE t.title = 'Write the runbook' AND r.release_number = 0),
  'an open task under a phase moves onto the MVP');

-- ---------- Running it again changes nothing ----------
SELECT set_config('test.before', (
  SELECT (SELECT count(*) FROM public.business_stage_transitions)::text || ','
      || (SELECT count(*) FROM public.release_transitions)::text || ','
      || (SELECT count(*) FROM public.release_artifacts)::text || ','
      || (SELECT count(*) FROM public.product_gate_decisions)::text
), false);
SELECT public.lifecycle_backfill_0_3();
SELECT test.assert_eq(
  (SELECT (SELECT count(*) FROM public.business_stage_transitions)::text || ','
       || (SELECT count(*) FROM public.release_transitions)::text || ','
       || (SELECT count(*) FROM public.release_artifacts)::text || ','
       || (SELECT count(*) FROM public.product_gate_decisions)::text),
  current_setting('test.before'), 'a second run adds nothing');

-- ---------- The retired lifecycle answers with a clear refusal ----------
SELECT test.assert_raises(
  $$SELECT public.advance_lifecycle_phase(
      (SELECT id FROM public.product_lifecycle_phases
       WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'code_test'),
      'complete')$$,
  'lifecycle is retired', 'advancing a lifecycle phase is refused');

-- Lifecycle artifacts are no longer writable by clients.
SELECT test.as_user('alice');
SELECT test.assert_raises(
  $$INSERT INTO public.phase_artifacts (phase_id, artifact_type, title, url)
    SELECT id, 'prd', 'New', 'https://example.com/new'
    FROM public.product_lifecycle_phases
    WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'requirements'$$,
  'permission denied', 'new lifecycle artifacts cannot be filed');

-- ---------- The release tables are back to their strict form ----------
SELECT test.as_superuser();
ALTER TABLE public.product_releases ALTER COLUMN release_number SET NOT NULL;
ALTER TABLE public.product_releases ADD CONSTRAINT product_releases_status_matches_stage CHECK (
  status IN ('cancelled', 'rolled_back')
  OR status = public.release_status_for_stage(stage)
);
SELECT test.assert(TRUE, 'the stricter constraints hold on backfilled data');
