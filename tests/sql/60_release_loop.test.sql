-- Release loop: Release 0 on Gate 1, the artifact policy and its snapshot, the
-- six stages and what closes each, the waiver rule, and the exits (cancel,
-- roll back, reopen). Jadawel (alice) is medium risk; admin is the founder.

-- ---------- Setup: pass Gate 1 for Jadawel ----------
UPDATE public.team_members SET is_founder = true WHERE user_id = test.uid('admin');

SELECT test.as_user('alice');
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'concept');
SELECT public.update_product_business(
  '10000000-0000-4000-8000-000000000001', 'discovery', 'code92_full', NULL,
  'Sara Al-Najjar', NULL, NULL, NULL, NULL);
SELECT test.as_user('admin');
SELECT public.record_gate_decision('10000000-0000-4000-8000-000000000001', 1, 'go', 'Operator confirmed');
SELECT test.as_user('alice');
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'build');

SELECT set_config('test.mvp', (
  SELECT id::text FROM public.product_releases
  WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0
), false);

-- ---------- Release 0: the policy is snapshotted when it is created ----------
SELECT test.assert_eq(
  (SELECT count(*) FROM public.release_artifact_requirements
   WHERE release_id = current_setting('test.mvp')::uuid),
  14::bigint, 'the snapshot covers every artifact key');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.release_artifact_requirements
   WHERE release_id = current_setting('test.mvp')::uuid AND is_required),
  8::bigint, 'a medium MVP requires eight artifacts');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.release_checks WHERE release_id = current_setting('test.mvp')::uuid),
  3::bigint, 'a medium release has three checks');
SELECT test.assert_eq(
  (SELECT risk_tier FROM public.product_releases WHERE id = current_setting('test.mvp')::uuid),
  'medium', 'the risk tier is copied from the product');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.release_overview
   WHERE id = current_setting('test.mvp')::uuid AND is_mvp AND stage = 'plan'),
  1::bigint, 'release_overview shows the MVP at Plan');

-- Clients cannot insert releases directly: the RPC is the only path.
SELECT test.assert_raises(
  $$INSERT INTO public.product_releases (product_id, version, created_by)
    VALUES ('10000000-0000-4000-8000-000000000001', 'rogue', test.uid('alice'))$$,
  'permission denied', 'releases are created through the RPC only');

-- ---------- Plan → Design: evidence, then the move ----------
SELECT test.assert_raises(
  $$SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'design')$$,
  'cannot close plan yet', 'Plan does not close without its evidence');

SELECT test.assert_raises(
  $$SELECT public.add_release_artifact(current_setting('test.mvp')::uuid, 'spec', 'Spec', 'https://example.com/spec')$$,
  'has not reached yet', 'evidence for a later stage cannot be filed early');

SELECT public.add_release_artifact(
  current_setting('test.mvp')::uuid, 'intent', 'Intent', 'https://github.com/code92/jadawel/blob/main/docs/intent.md');
SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'design');
SELECT test.assert(
  (SELECT stage = 'design' AND status = 'in_progress'
   FROM public.product_releases WHERE id = current_setting('test.mvp')::uuid),
  'Plan → Design moves the stage and derives the status');
SELECT test.assert(
  (SELECT from_stage = 'plan' AND to_stage = 'design' AND cardinality(artifact_ids) = 1
   FROM public.release_transitions
   WHERE release_id = current_setting('test.mvp')::uuid AND to_stage = 'design'),
  'the transition records the stage pair and the evidence that closed Plan');

-- ---------- Design: spec, plan, approval ----------
SELECT test.assert_raises(
  $$SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'build')$$,
  'cannot close design yet', 'Design needs its artifacts');

SELECT public.add_release_artifact(
  current_setting('test.mvp')::uuid, 'spec', 'Spec', 'https://github.com/code92/jadawel/blob/main/docs/spec.md');
SELECT public.add_release_artifact(
  current_setting('test.mvp')::uuid, 'plan', 'Plan', 'https://github.com/code92/jadawel/blob/main/docs/plan.md');
SELECT test.assert_raises(
  $$SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'build')$$,
  'spec_approval', 'an approved spec is part of closing Design');

SELECT public.approve_release_spec(current_setting('test.mvp')::uuid);
SELECT test.assert(
  (SELECT spec_approved_by = test.uid('alice') AND spec_self_approved
   FROM public.product_releases WHERE id = current_setting('test.mvp')::uuid),
  'the approver is recorded, and approving your own spec is flagged');
SELECT test.assert_raises(
  $$SELECT public.approve_release_spec(current_setting('test.mvp')::uuid)$$,
  'already approved', 'a spec is approved once');

SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'build');

-- ---------- Build: the pull request ----------
SELECT test.assert_raises(
  $$SELECT public.add_release_artifact(current_setting('test.mvp')::uuid, 'test_results', 'CI', 'https://ci.example.com/run/1')$$,
  'has not reached yet', 'test evidence waits for Test');
SELECT test.assert_raises(
  $$SELECT public.add_release_artifact(current_setting('test.mvp')::uuid, 'pull_request', 'PR', 'ftp://not-http')$$,
  'check constraint', 'artifact links must be http or https');

SELECT public.add_release_artifact(
  current_setting('test.mvp')::uuid, 'pull_request', 'Build PR',
  'https://github.com/code92/jadawel/pull/12', 'a1b2c3d');
SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'test');

-- ---------- Test: results, findings, pass ----------
SELECT public.add_release_artifact(
  current_setting('test.mvp')::uuid, 'test_results', 'CI run', 'https://ci.example.com/run/1');
SELECT public.add_release_artifact(
  current_setting('test.mvp')::uuid, 'review_findings', 'Review', 'https://github.com/code92/jadawel/pull/12#review');

SELECT test.assert_raises(
  $$SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'deploy')$$,
  'test_pass', 'Test does not close without a pass');

SELECT public.set_release_test_result(current_setting('test.mvp')::uuid, 'pass', 1, 0);
SELECT test.assert_raises(
  $$SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'deploy')$$,
  'findings_closed', 'open findings block Test from closing');

SELECT public.set_release_test_result(current_setting('test.mvp')::uuid, 'pass', 0, 2);
SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'deploy');
SELECT test.assert(
  (SELECT stage = 'deploy' AND status = 'ready'
   FROM public.product_releases WHERE id = current_setting('test.mvp')::uuid),
  'entering Deploy means the release is ready to ship');

-- ---------- Deploy: release tag, checklist, checks, open work ----------
SELECT public.add_release_artifact(
  current_setting('test.mvp')::uuid, 'release_tag', 'v1.0.0', 'https://github.com/code92/jadawel/releases/tag/v1.0.0', 'v1.0.0');
SELECT public.add_release_artifact(
  current_setting('test.mvp')::uuid, 'deploy_checklist', 'Deploy checklist', 'https://github.com/code92/jadawel/blob/main/docs/deploy.md');

INSERT INTO public.product_tasks (product_id, title, created_by, release_id)
VALUES ('10000000-0000-4000-8000-000000000001', 'Write the release notes',
        test.uid('alice'), current_setting('test.mvp')::uuid);

-- Medium risk: unmet checks and open tasks are recorded, not blocking.
SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'maintain');
SELECT test.assert(
  (SELECT status = 'released' AND released_at IS NOT NULL
   FROM public.product_releases WHERE id = current_setting('test.mvp')::uuid),
  'shipping sets the status and the release date');
SELECT test.assert(
  (SELECT 'qa_signoff' = ANY(missing_checks) AND 'open_tasks' = ANY(missing_checks)
     AND waiver_reason IS NULL AND NOT self_approved
   FROM public.release_transitions
   WHERE release_id = current_setting('test.mvp')::uuid AND to_stage = 'maintain'),
  'a medium release ships with its gaps recorded and no waiver');

-- Shipped releases do not move back by stage; they roll back, with a reason.
SELECT test.assert_raises(
  $$SELECT public.move_release_stage(current_setting('test.mvp')::uuid, 'deploy', 'oops')$$,
  'cannot move back', 'a shipped release does not move back by stage');
SELECT test.assert_raises(
  $$SELECT public.advance_release_status(current_setting('test.mvp')::uuid, 'rolled_back')$$,
  'a reason is required', 'a rollback needs a reason');
SELECT test.assert_raises(
  $$SELECT public.advance_release_status(current_setting('test.mvp')::uuid, 'ready')$$,
  'cannot move from', 'a shipped release cannot be made ready again');

SELECT public.advance_release_status(current_setting('test.mvp')::uuid, 'rolled_back', 'Login regression');
SELECT test.assert(
  (SELECT status = 'rolled_back' AND released_at IS NOT NULL AND stage = 'maintain'
   FROM public.product_releases WHERE id = current_setting('test.mvp')::uuid),
  'a rollback keeps the shipping date and the stage');

SELECT public.advance_release_status(current_setting('test.mvp')::uuid, 'in_progress', 'Fixing and shipping again');
SELECT test.assert(
  (SELECT status = 'in_progress' AND stage = 'build' AND released_at IS NULL
   FROM public.product_releases WHERE id = current_setting('test.mvp')::uuid),
  'reopening a rolled-back release starts again at Build');

-- ---------- Ownership: a non-owner cannot file or move ----------
SELECT test.as_user('bob');
SELECT test.assert_raises(
  $$SELECT public.add_release_artifact(current_setting('test.mvp')::uuid, 'intent', 'Mine', 'https://example.com/x')$$,
  'only the product owner or an admin', 'only the owner or an admin files artifacts');

-- ---------- Cycles ----------
-- Cliko is bob's and still at Idea: no cycle until Gate 1 passes.
SELECT test.as_user('bob');
SELECT test.assert_raises(
  $$SELECT public.create_cycle_release('10000000-0000-4000-8000-000000000002', '2.0', 'Goal')$$,
  'Gate 1 passed', 'a cycle needs Gate 1 passed');

SELECT test.as_user('alice');
SELECT test.assert_raises(
  $$SELECT public.create_cycle_release('10000000-0000-4000-8000-000000000001', '1.1.0', '   ')$$,
  'one-line goal', 'a cycle needs a goal');

SELECT set_config('test.cycle', (
  SELECT id::text FROM public.create_cycle_release(
    '10000000-0000-4000-8000-000000000001', '1.1.0', 'Add invoice export',
    (public.business_today() + 30)
  )
), false);

SELECT test.assert_eq(
  (SELECT release_number FROM public.product_releases WHERE id = current_setting('test.cycle')::uuid),
  1, 'cycles are numbered after the MVP');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.release_artifact_requirements
   WHERE release_id = current_setting('test.cycle')::uuid AND is_required),
  5::bigint, 'a medium cycle requires five artifacts');

-- ---------- A cycle through to Maintain, with the high-risk waiver ----------
SELECT public.add_release_artifact(
  current_setting('test.cycle')::uuid, 'intent', 'Intent', 'https://github.com/code92/jadawel/blob/main/docs/intent-1.1.md');
SELECT public.move_release_stage(current_setting('test.cycle')::uuid, 'design');
SELECT public.add_release_artifact(
  current_setting('test.cycle')::uuid, 'spec', 'Spec', 'https://github.com/code92/jadawel/blob/main/docs/spec-1.1.md');
SELECT public.approve_release_spec(current_setting('test.cycle')::uuid);
SELECT public.move_release_stage(current_setting('test.cycle')::uuid, 'build');
SELECT public.add_release_artifact(
  current_setting('test.cycle')::uuid, 'pull_request', 'PR', 'https://github.com/code92/jadawel/pull/15');
SELECT public.move_release_stage(current_setting('test.cycle')::uuid, 'test');
SELECT public.add_release_artifact(
  current_setting('test.cycle')::uuid, 'test_results', 'CI', 'https://ci.example.com/run/2');
SELECT public.set_release_test_result(current_setting('test.cycle')::uuid, 'pass', 0, 0);
SELECT public.move_release_stage(current_setting('test.cycle')::uuid, 'deploy');
SELECT public.add_release_artifact(
  current_setting('test.cycle')::uuid, 'release_tag', 'v1.1.0', 'https://github.com/code92/jadawel/releases/tag/v1.1.0', 'v1.1.0');

-- Backward needs a note, and the reason is kept on the transition.
SELECT test.assert_raises(
  $$SELECT public.move_release_stage(current_setting('test.cycle')::uuid, 'test')$$,
  'a note is required', 'moving a release backward needs a note');
SELECT public.move_release_stage(current_setting('test.cycle')::uuid, 'test', 'Smoke test failed in staging');
SELECT public.move_release_stage(current_setting('test.cycle')::uuid, 'deploy');

-- The risk tier is raised to high by an admin. High risk turns the unmet
-- checks into a waiver that someone must write down.
SELECT test.as_user('admin');
UPDATE public.product_releases SET risk_tier = 'high' WHERE id = current_setting('test.cycle')::uuid;

SELECT test.assert_raises(
  $$SELECT public.move_release_stage(current_setting('test.cycle')::uuid, 'maintain')$$,
  'waiver reason is required', 'a high-risk release needs a waiver reason for unmet checks');

SELECT public.move_release_stage(
  current_setting('test.cycle')::uuid, 'maintain', 'Shipping ahead of the QA sign-off on Monday');
SELECT test.assert(
  (SELECT waiver_reason = 'Shipping ahead of the QA sign-off on Monday' AND 'qa_signoff' = ANY(missing_checks)
   FROM public.release_transitions
   WHERE release_id = current_setting('test.cycle')::uuid AND to_stage = 'maintain'),
  'a high-risk waiver is recorded with the reason and the gaps it covered');

-- A high-risk release is admin-only to move, even for its owner.
SELECT test.as_user('alice');
SELECT test.assert_raises(
  $$SELECT public.advance_release_status(current_setting('test.cycle')::uuid, 'rolled_back', 'Login regression')$$,
  'need an admin', 'a high-risk release is admin-only to change');

-- A shipped release is rolled back, not cancelled.
SELECT test.as_user('admin');
SELECT test.assert_raises(
  $$SELECT public.advance_release_status(current_setting('test.cycle')::uuid, 'cancelled', 'Scope changed')$$,
  'cannot move from released', 'a shipped cycle cannot be cancelled; it rolls back');
SELECT test.as_user('alice');

SELECT public.create_cycle_release(
  '10000000-0000-4000-8000-000000000001', '1.2.0', 'Dark mode');
SELECT set_config('test.cycle2', (
  SELECT id::text FROM public.product_releases
  WHERE product_id = '10000000-0000-4000-8000-000000000001' AND version = '1.2.0'
), false);
SELECT test.assert_raises(
  $$SELECT public.advance_release_status(current_setting('test.cycle2')::uuid, 'cancelled')$$,
  'a reason is required', 'cancelling needs a reason');
SELECT public.advance_release_status(current_setting('test.cycle2')::uuid, 'cancelled', 'Deprioritised');
SELECT test.assert_raises(
  $$SELECT public.add_release_artifact(current_setting('test.cycle2')::uuid, 'intent', 'x', 'https://example.com/x')$$,
  'cancelled release', 'a cancelled release takes no evidence');
SELECT public.advance_release_status(current_setting('test.cycle2')::uuid, 'planned', 'Back on');
SELECT test.assert(
  (SELECT status = 'planned' AND stage = 'plan'
   FROM public.product_releases WHERE id = current_setting('test.cycle2')::uuid),
  're-planning starts the loop again at Plan');

-- ---------- The governance log holds every kind of decision ----------
SELECT test.as_user('admin');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.governance_gate_log
          WHERE product_id = '10000000-0000-4000-8000-000000000001' AND kind = 'release_stage'),
  'stage moves are in the governance log');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.governance_gate_log
          WHERE product_id = '10000000-0000-4000-8000-000000000001' AND kind = 'release_approval'),
  'spec approvals are in the governance log');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.governance_gate_log
          WHERE product_id = '10000000-0000-4000-8000-000000000001' AND kind = 'release_status'
            AND to_value = 'rolled_back'),
  'status changes are in the governance log');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.governance_gate_log
          WHERE product_id = '10000000-0000-4000-8000-000000000001' AND kind = 'gate_decision'
            AND decision = 'go' AND gate = 1),
  'gate decisions are in the governance log');
