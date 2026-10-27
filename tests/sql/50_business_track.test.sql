-- Business track: the funnel's stages, the two gates, checklists, business
-- fields, watchers. Jadawel (alice owns it) is the product walked through the
-- funnel. admin is the founder who decides; bob is an active non-founder; eve is
-- inactive.

-- ---------- Setup as superuser ----------
UPDATE public.team_members SET is_founder = true WHERE user_id = test.uid('admin');

-- ---------- Every product starts at Idea with the funnel's checklists ----------
SELECT test.assert_eq(
  (SELECT business_stage FROM public.products WHERE id = '10000000-0000-4000-8000-000000000001'),
  'idea', 'products start at Idea');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.product_stage_checklist_items
   WHERE product_id = '10000000-0000-4000-8000-000000000001'),
  19::bigint, 'every stage seeded with its defaults');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.product_stage_checklist_items
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND stage = 'idea'
     AND default_key IS NOT NULL),
  3::bigint, 'idea defaults carry their keys');

-- A client cannot even name business_stage on insert: the product insert grant
-- is column-scoped, and stage is not in it. A plain insert lands at Idea.
SELECT test.as_user('alice');
SELECT test.assert_raises(
  $$INSERT INTO public.products (id, name, slug, owner_id, business_stage)
    VALUES ('10000000-0000-4000-8000-0000000000a1', 'Late', 'late', test.uid('alice'), 'build')$$,
  'permission denied', 'business_stage is not insertable by a client');
INSERT INTO public.products (id, name, slug, owner_id)
VALUES ('10000000-0000-4000-8000-0000000000a1', 'Early', 'early', test.uid('alice'));
SELECT test.assert_eq(
  (SELECT business_stage FROM public.products WHERE id = '10000000-0000-4000-8000-0000000000a1'),
  'idea', 'a new product starts at Idea');

-- Stage has no column grant: only move_business_stage() can write it.
SELECT test.assert_raises(
  $$UPDATE public.products SET business_stage = 'build' WHERE id = '10000000-0000-4000-8000-000000000001'$$,
  'permission denied', 'business_stage is not writable directly');

-- ---------- Stages move one at a time; backward needs a reason ----------
SELECT test.assert_raises(
  $$SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'build')$$,
  'move one stage at a time', 'no skipping stages');

SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'concept');
SELECT test.assert_eq(
  (SELECT business_stage FROM public.products WHERE id = '10000000-0000-4000-8000-000000000001'),
  'concept', 'idea → concept moves without a gate');

-- ---------- Business details: RPC only, owner or business owner or admin ----------
SELECT test.assert_raises(
  $$SELECT public.update_product_business('10000000-0000-4000-8000-000000000001', 'discovery', 'co_owned', NULL, NULL, NULL, NULL, NULL, NULL)$$,
  'equity', 'co-owned needs the Code92 equity share');

SELECT public.update_product_business(
  '10000000-0000-4000-8000-000000000001', 'discovery', 'code92_full', NULL,
  '  ', NULL, NULL, test.uid('bob'), 'Health');
SELECT test.assert(
  (SELECT operator_name IS NULL AND business_owner_id = test.uid('bob') AND sector = 'Health'
   FROM public.products WHERE id = '10000000-0000-4000-8000-000000000001'),
  'blank operator name is stored as none; business owner and sector set');

-- An inactive person cannot change business details.
SELECT test.as_user('eve');
SELECT test.assert_raises(
  $$SELECT public.update_product_business('10000000-0000-4000-8000-000000000001', 'discovery', 'code92_full', NULL, 'X', NULL, NULL, NULL, NULL)$$,
  'only the product owner', 'inactive members cannot change business details');

-- ---------- Gate 1: a named operator and a founder's go ----------
SELECT test.as_user('alice');
SELECT public.update_product_business(
  '10000000-0000-4000-8000-000000000001', 'discovery', 'code92_full', NULL,
  'Sara Al-Najjar', NULL, NULL, test.uid('bob'), 'Health');

SELECT test.assert_raises(
  $$SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'build')$$,
  'go decision', 'Gate 1 needs a go decision');

-- A non-founder cannot record the decision, even as the product owner.
SELECT test.assert_raises(
  $$SELECT public.record_gate_decision('10000000-0000-4000-8000-000000000001', 1, 'go', 'Looks good')$$,
  'only founders', 'only founders decide a gate');

SELECT test.as_user('admin');
-- A gate decision needs a note.
SELECT test.assert_raises(
  $$SELECT public.record_gate_decision('10000000-0000-4000-8000-000000000001', 1, 'go', '   ')$$,
  'note is required', 'a gate decision needs a note');
-- Gate 2 is not decided at Concept.
SELECT test.assert_raises(
  $$SELECT public.record_gate_decision('10000000-0000-4000-8000-000000000001', 2, 'go', 'PMF', 'criteria', 'evidence')$$,
  'Gate 2 is decided while', 'Gate 2 waits for Venture');

-- A no-go is recorded and does not pass the gate.
SELECT public.record_gate_decision('10000000-0000-4000-8000-000000000001', 1, 'no_go', 'Not this quarter');
SELECT test.assert_raises(
  $$SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'build')$$,
  'go decision', 'a no-go does not pass Gate 1');

SELECT public.record_gate_decision('10000000-0000-4000-8000-000000000001', 1, 'go', 'Operator confirmed; go to build');
SELECT test.assert_eq(
  public.latest_gate_outcome('10000000-0000-4000-8000-000000000001', 1), 'go',
  'the latest decision is the one that counts');

-- ---------- Passing Gate 1 moves the product and opens the development track ----------
SELECT test.as_user('alice');
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'build');
SELECT test.assert_eq(
  (SELECT business_stage FROM public.products WHERE id = '10000000-0000-4000-8000-000000000001'),
  'build', 'Gate 1 passed: the product is in Build');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.product_releases
          WHERE product_id = '10000000-0000-4000-8000-000000000001'
            AND release_number = 0 AND version = 'MVP' AND stage = 'plan' AND status = 'planned'),
  'Gate 1 creates Release 0 at Plan');

-- Going back and forward again does not create a second Release 0.
SELECT test.assert_raises(
  $$SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'concept')$$,
  'reason required', 'backward moves need a reason');
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'concept', 'Scope under review');
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'build');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.product_releases
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND release_number = 0),
  1::bigint, 'Release 0 is created once');

-- ---------- Gate 2: PMF criteria and evidence ----------
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'venture');

SELECT test.as_user('admin');
SELECT test.assert_raises(
  $$SELECT public.record_gate_decision('10000000-0000-4000-8000-000000000001', 2, 'go', 'PMF reached', NULL, NULL)$$,
  'PMF criteria and evidence are required', 'a Gate 2 go needs criteria and evidence');
SELECT test.assert_raises(
  $$SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'company')$$,
  'Gate 2 needs', 'no PMF decision, no company');

SELECT public.record_gate_decision(
  '10000000-0000-4000-8000-000000000001', 2, 'go', 'Retention above target for two quarters',
  '30-day retention above 40 percent', 'https://example.com/metrics/retention');

SELECT test.as_user('alice');
SELECT public.move_business_stage('10000000-0000-4000-8000-000000000001', 'company');
SELECT test.assert_eq(
  (SELECT business_stage FROM public.products WHERE id = '10000000-0000-4000-8000-000000000001'),
  'company', 'Gate 2 passed: the product is a company');

-- Every move is in the log, with the gate decision that let it through.
SELECT test.assert_eq(
  (SELECT count(*) FROM public.business_stage_transitions
   WHERE product_id = '10000000-0000-4000-8000-000000000001'),
  6::bigint, 'every stage move is logged');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.business_stage_transitions
          WHERE product_id = '10000000-0000-4000-8000-000000000001'
            AND to_stage = 'company' AND gate_decision_id IS NOT NULL),
  'the Gate 2 move records its decision');

-- ---------- Checklists guide; ticking records who and when ----------
SELECT test.as_user('alice');
UPDATE public.product_stage_checklist_items SET done = true
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND default_key = 'pricing';
SELECT test.assert(
  (SELECT done AND done_by = test.uid('alice') AND done_at IS NOT NULL
   FROM public.product_stage_checklist_items
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND default_key = 'pricing'),
  'ticking an item records who ticked it and when');

-- done_by cannot be forged, and unticking clears both.
SELECT test.assert_raises(
  $$UPDATE public.product_stage_checklist_items SET done_by = test.uid('bob')
    WHERE product_id = '10000000-0000-4000-8000-000000000001' AND default_key = 'pricing'$$,
  'permission denied', 'done_by is not writable');
UPDATE public.product_stage_checklist_items SET done = false
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND default_key = 'pricing';
SELECT test.assert(
  (SELECT done_at IS NULL AND done_by IS NULL FROM public.product_stage_checklist_items
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND default_key = 'pricing'),
  'unticking clears who and when');

-- Someone outside the business track cannot tick: the update simply finds no rows.
SELECT test.as_user('eve');
UPDATE public.product_stage_checklist_items SET done = true
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND default_key = 'gtm_plan';
SELECT test.as_superuser();
SELECT test.assert_eq(
  (SELECT count(*) FROM public.product_stage_checklist_items
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND done),
  0::bigint, 'an outsider cannot tick a checklist item');

-- ---------- Watchers: only yourself ----------
SELECT test.as_user('bob');
INSERT INTO public.product_watchers (product_id, user_id)
VALUES ('10000000-0000-4000-8000-000000000001', test.uid('bob'));
SELECT test.assert_raises(
  $$INSERT INTO public.product_watchers (product_id, user_id)
    VALUES ('10000000-0000-4000-8000-000000000001', test.uid('alice'))$$,
  'row-level security', 'you can only add yourself as a watcher');

-- ---------- Products overview carries the track ----------
SELECT test.as_user('alice');
SELECT test.assert_eq(
  (SELECT business_stage FROM public.product_overview WHERE id = '10000000-0000-4000-8000-000000000001'),
  'company', 'product_overview shows the business stage');
SELECT test.assert_eq(
  (SELECT current_release_version FROM public.product_overview WHERE id = '10000000-0000-4000-8000-000000000001'),
  'MVP', 'product_overview shows the current release');
