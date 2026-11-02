-- Projects: a consultation win opens one; phases move with a log and an outcome
-- note; a project has its own room that closes with it; an idea captured from a
-- project becomes a product at Idea, linked both ways; project tasks; staleness.

-- ---------- A consultation deal, won by bob ----------
SELECT test.as_user('alice');
INSERT INTO public.accounts (id, name, owner_id, sector)
VALUES ('30000000-0000-4000-8000-0000000000c1', 'Ministry Labs', test.uid('alice'), 'Gov');
INSERT INTO public.deals (id, account_id, name, type, owner_id, stage)
VALUES ('40000000-0000-4000-8000-0000000000c1', '30000000-0000-4000-8000-0000000000c1',
        'Data platform build', 'consultation', test.uid('bob'), 'negotiation');

SELECT test.as_user('bob');
SELECT public.move_deal_stage('40000000-0000-4000-8000-0000000000c1', 'closed_won', NULL, 'code92_full');

SELECT set_config('test.project', (
  SELECT id::text FROM public.projects WHERE deal_id = '40000000-0000-4000-8000-0000000000c1'
), false);

SELECT test.assert(
  (SELECT phase = 'kickoff' AND owner_id = test.uid('bob') AND name = 'Data platform build'
     AND ownership = 'code92_full' AND account_id = '30000000-0000-4000-8000-0000000000c1'
   FROM public.projects WHERE id = current_setting('test.project')::uuid),
  'a consultation win opens a project in Kickoff, owned by the deal owner');

-- The project has its own room, open.
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.channels
          WHERE project_id = current_setting('test.project')::uuid
            AND kind = 'project' AND is_primary AND archived_at IS NULL),
  'the project has a primary room, open');

-- Re-winning a reopened deal keeps the one project and updates its ownership.
SELECT public.move_deal_stage('40000000-0000-4000-8000-0000000000c1', 'negotiation', 'Scope change');
SELECT public.move_deal_stage('40000000-0000-4000-8000-0000000000c1', 'closed_won', NULL, 'client');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.projects WHERE deal_id = '40000000-0000-4000-8000-0000000000c1'),
  1::bigint, 'one project per deal');
SELECT test.assert_eq(
  (SELECT ownership FROM public.projects WHERE id = current_setting('test.project')::uuid),
  'client', 'the re-win updates ownership');

-- ---------- Phases move with a log ----------
SELECT test.as_user('alice');
SELECT public.move_project_phase(current_setting('test.project')::uuid, 'discovery');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.project_activities
   WHERE project_id = current_setting('test.project')::uuid AND kind = 'phase_change'
     AND from_phase = 'kickoff' AND to_phase = 'discovery'),
  1::bigint, 'the phase move is logged with its from and to');

SELECT test.assert_raises(
  $$SELECT public.move_project_phase(current_setting('test.project')::uuid, 'discovery')$$,
  'already in phase', 'moving to the current phase is refused');

-- Closing needs an outcome note.
SELECT test.assert_raises(
  $$SELECT public.move_project_phase(current_setting('test.project')::uuid, 'closed')$$,
  'outcome note', 'closing needs an outcome note');

SELECT public.move_project_phase(current_setting('test.project')::uuid, 'closed',
  'Delivered the platform; handed over to the ministry team');
SELECT test.assert(
  (SELECT phase = 'closed' AND closed_at IS NOT NULL AND outcome_note LIKE 'Delivered%'
   FROM public.projects WHERE id = current_setting('test.project')::uuid),
  'closing records the outcome and the date');
SELECT test.assert(
  (SELECT archived_at IS NOT NULL FROM public.channels
   WHERE project_id = current_setting('test.project')::uuid AND is_primary),
  'closing archives the project room');

-- Reopening brings the room back.
SELECT public.move_project_phase(current_setting('test.project')::uuid, 'delivery', 'Client asked for a change');
SELECT test.assert(
  (SELECT archived_at IS NULL FROM public.channels
   WHERE project_id = current_setting('test.project')::uuid AND is_primary),
  'reopening brings the room back');
SELECT test.assert(
  (SELECT closed_at IS NULL AND phase = 'delivery' FROM public.projects
   WHERE id = current_setting('test.project')::uuid),
  'reopening clears the closed date');

-- ---------- Notes: members add their own; the rest is written by the system ----------
INSERT INTO public.project_activities (project_id, actor_id, kind, body)
VALUES (current_setting('test.project')::uuid, test.uid('alice'), 'note', 'Kickoff call held');

SELECT test.assert_raises(
  $$INSERT INTO public.project_activities (project_id, actor_id, kind, from_phase, to_phase)
    VALUES (current_setting('test.project')::uuid, test.uid('alice'), 'phase_change', 'delivery', 'closed')$$,
  'permission denied', 'members cannot write a phase change by hand');

-- ---------- Capture idea: a product at Idea, linked both ways ----------
SELECT test.assert_raises(
  $$SELECT public.capture_project_idea(current_setting('test.project')::uuid, '   ', 'Problem')$$,
  'name of up to 200', 'an idea needs a name');
SELECT test.assert_raises(
  $$SELECT public.capture_project_idea(current_setting('test.project')::uuid, 'Lab Scheduler', NULL)$$,
  'problem statement is required', 'an idea needs a problem statement');

SELECT set_config('test.idea', (
  SELECT id::text FROM public.capture_project_idea(
    current_setting('test.project')::uuid, 'Lab Scheduler', 'Labs are booked by hand, in person'
  )
), false);

SELECT test.assert(
  (SELECT business_stage = 'idea' AND origination = 'discovery' AND owner_id = test.uid('alice')
     AND description = 'Labs are booked by hand, in person'
     AND slug LIKE 'lab-scheduler-%'
   FROM public.products WHERE id = current_setting('test.idea')::uuid),
  'a captured idea is a product at Idea, with its problem statement');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.product_stage_checklist_items
   WHERE product_id = current_setting('test.idea')::uuid),
  19::bigint, 'a captured idea gets the checklists like any product');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.project_products
          WHERE project_id = current_setting('test.project')::uuid
            AND product_id = current_setting('test.idea')::uuid),
  'the project lists the idea');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.project_activities
          WHERE project_id = current_setting('test.project')::uuid
            AND kind = 'idea_captured' AND meta->>'product_id' = current_setting('test.idea')::text),
  'the project log records the capture');

-- ---------- Tasks belong to a product, a project, or nothing ----------
SELECT test.assert_raises(
  $$INSERT INTO public.product_tasks (product_id, project_id, title, created_by)
    VALUES ('10000000-0000-4000-8000-000000000001', current_setting('test.project')::uuid, 'Both', test.uid('alice'))$$,
  'product_tasks_one_scope', 'a task has one scope');

INSERT INTO public.product_tasks (project_id, title, created_by)
VALUES (current_setting('test.project')::uuid, 'Confirm the data sources', test.uid('alice'));

SELECT test.assert_raises(
  $$INSERT INTO public.product_tasks (project_id, title, created_by, release_id)
    VALUES (current_setting('test.project')::uuid, 'Scoped', test.uid('alice'),
            '90000000-0000-4000-8000-000000000001')$$,
  'only a product task can join a release', 'a project task cannot join a release');

SELECT test.assert_raises(
  $$UPDATE public.product_tasks SET project_id = NULL
    WHERE project_id = current_setting('test.project')::uuid$$,
  'permission denied', 'a task cannot leave its project');

-- ---------- Project channel binding ----------
SELECT test.as_superuser();
SELECT test.assert_raises(
  $$INSERT INTO public.channels (slug, name, kind) VALUES ('orphan-project', 'Orphan', 'project')$$,
  'channels_kind_binding', 'a project channel must name its project');

-- A member can open a secondary room in an open project, and it closes with it.
SELECT test.as_user('alice');
INSERT INTO public.channels (slug, name, kind, project_id, created_by)
VALUES ('lab-room', 'Lab room', 'project', current_setting('test.project')::uuid, test.uid('alice'));
SELECT test.assert_raises(
  $$INSERT INTO public.channels (slug, name, kind, project_id, created_by, is_primary)
    VALUES ('rogue-primary', 'Rogue', 'project', current_setting('test.project')::uuid, test.uid('alice'), true)$$,
  'permission denied', 'a member cannot make a second primary room');

SELECT public.move_project_phase(current_setting('test.project')::uuid, 'closed', 'Wrapped up');
SELECT test.assert(
  (SELECT archived_at IS NOT NULL FROM public.channels WHERE slug = 'lab-room'),
  'the secondary room closes with the project');
SELECT test.assert_raises(
  $$INSERT INTO public.channels (slug, name, kind, project_id, created_by)
    VALUES ('late-room', 'Late', 'project', current_setting('test.project')::uuid, test.uid('alice'))$$,
  'row-level security', 'no new rooms in a closed project');
SELECT public.move_project_phase(current_setting('test.project')::uuid, 'delivery', 'Reopened for a follow-up');

-- ---------- Overview and staleness ----------
SELECT test.assert(
  (SELECT is_open AND NOT is_stale AND task_count = 1 AND idea_count = 1 AND channel_id IS NOT NULL
   FROM public.project_overview WHERE id = current_setting('test.project')::uuid),
  'an active project with work and a room is open and not stale');

SELECT test.as_superuser();
UPDATE public.projects SET created_at = now() - interval '30 days'
WHERE id = current_setting('test.project')::uuid;
UPDATE public.project_activities SET created_at = now() - interval '30 days'
WHERE project_id = current_setting('test.project')::uuid;
-- The updated_at trigger would stamp now() over the backdated value, so it is
-- off for this one statement.
ALTER TABLE public.product_tasks DISABLE TRIGGER product_tasks_updated_at;
UPDATE public.product_tasks SET created_at = now() - interval '30 days', updated_at = now() - interval '30 days'
WHERE project_id = current_setting('test.project')::uuid;
ALTER TABLE public.product_tasks ENABLE TRIGGER product_tasks_updated_at;

SELECT test.as_user('alice');
SELECT test.assert(
  (SELECT is_stale FROM public.project_overview WHERE id = current_setting('test.project')::uuid),
  'two weeks without a task or log entry makes a project stale');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.project_overview WHERE id = current_setting('test.project')::uuid AND is_stale),
  1::bigint, 'the stale flag is visible to the team');
