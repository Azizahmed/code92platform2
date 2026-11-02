-- Dashboard strips and attention, and the loop's kinds in my_waiting_on(). The
-- same predicates back the links on the dashboard, so these counts are the lists.

UPDATE public.team_members SET is_founder = true WHERE user_id = test.uid('admin');

-- ---------- Strips and attention for the team ----------
SELECT test.as_user('admin');
SELECT test.assert_eq(
  (public.dashboard_strips()->'products'->>'idea')::int, 2,
  'both products count as Idea in the strips');
SELECT test.assert_eq(
  (public.dashboard_strips()->'projects'->>'kickoff')::int, 0,
  'no projects yet');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.dashboard_attention() WHERE kind = 'product_no_business_owner'),
  2::bigint, 'products without a business owner are on the attention list');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.dashboard_attention() WHERE kind = 'product_no_operator'),
  0::bigint, 'nothing past Gate 1 without an operator yet');

-- ---------- Gate 1 waiting on a founder ----------
SELECT test.as_user('alice');
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'concept');

SELECT test.as_user('admin');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'business_gate_pending'),
  1::bigint, 'a founder is asked for the Gate 1 decision');
SELECT test.assert_eq(
  (SELECT subtitle FROM public.my_waiting_on() WHERE source = 'business_gate_pending'),
  'Gate 1', 'the item names the gate');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.dashboard_attention() WHERE kind = 'gate_pending'),
  1::bigint, 'the gate is on the team attention list');

SELECT test.as_user('bob');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'business_gate_pending'),
  0::bigint, 'someone who is not a founder is not asked');

SELECT test.as_user('admin');
SELECT public.record_gate_decision('10000000-0000-4000-8000-000000000001', 1, 'go', 'Operator named; go');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'business_gate_pending'),
  0::bigint, 'a decision removes the item');

-- ---------- Gate 1 passed: the release waits on the owner ----------
SELECT test.as_user('alice');
SELECT public.update_product_business(
  '10000000-0000-4000-8000-000000000001', 'discovery', 'code92_full', NULL,
  'Sara Al-Najjar', NULL, NULL, NULL, NULL);
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'build');

SELECT test.assert(
  (SELECT stage = 'plan' FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0),
  'Release 0 exists at Plan');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'release_stage_ready'),
  0::bigint, 'nothing ready to close until the intent is filed');

SELECT public.add_release_artifact(
  (SELECT id FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0),
  'intent', 'Intent', 'https://example.com/intent');

SELECT test.assert_eq(
  (SELECT subtitle FROM public.my_waiting_on() WHERE source = 'release_stage_ready'),
  'Plan', 'filing the intent makes Plan ready to close');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'release_stage_ready'),
  1::bigint, 'the item is for the release owner');

SELECT test.as_user('bob');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'release_stage_ready'),
  0::bigint, 'not shown to someone who cannot move the release');

-- ---------- Design: the spec waits for approval ----------
SELECT test.as_user('alice');
SELECT public.move_release_stage(
  (SELECT id FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0),
  'design');
SELECT public.add_release_artifact(
  (SELECT id FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0),
  'spec', 'Spec', 'https://example.com/spec');
SELECT public.add_release_artifact(
  (SELECT id FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0),
  'plan', 'Plan', 'https://example.com/plan');

SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'release_spec_approval'),
  1::bigint, 'the spec waits for the owner to approve it');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'release_stage_ready'),
  0::bigint, 'Design is not ready while the spec waits for approval');

SELECT public.approve_release_spec(
  (SELECT id FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0));
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'release_spec_approval'),
  0::bigint, 'approving the spec clears it');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'release_stage_ready'),
  1::bigint, 'with the spec approved, Design is ready to close');

-- ---------- The badge counts the same list ----------
SELECT test.assert_eq(
  (SELECT waiting FROM public.my_work_counts()),
  (SELECT count(*)::int FROM public.my_waiting_on()),
  'the badge counts what is waiting');
