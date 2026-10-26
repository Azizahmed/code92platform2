-- my_waiting_on(): every source appears for the right person and leaves the
-- list once resolved; my_work_counts().

-- ---------- Fixtures that need superuser ----------
-- An agent, so there is something to propose.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-0000000000f1', NULL);
INSERT INTO public.team_members (user_id, display_name, role, is_active, kind)
VALUES ('00000000-0000-4000-8000-0000000000f1', 'Scout', 'member', true, 'agent');
INSERT INTO public.agents (user_id, handle, display_name, system_prompt, model)
VALUES ('00000000-0000-4000-8000-0000000000f1', 'scout', 'Scout', 'Be useful.', 'openai/gpt-4o-mini');

-- ---------- review_overdue ----------
SELECT test.as_user('alice');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on()
   WHERE source = 'review_overdue' AND record_id = '10000000-0000-4000-8000-000000000001'),
  1::bigint, 'overdue review shows for its owner');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE record_id = '10000000-0000-4000-8000-000000000002'),
  0::bigint, 'other owners'' products excluded');

INSERT INTO public.status_updates (product_id, author_id, health, summary)
VALUES ('10000000-0000-4000-8000-000000000001', test.uid('alice'), 'green', 'All good');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'review_overdue'),
  0::bigint, 'posting a status update resolves the overdue review');

-- ---------- gate_ready ----------
-- Jadawel is medium risk: requirements needs a PRD. Ideation needs nothing,
-- so an in-progress ideation phase is work, not a pending decision.
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'gate_ready'),
  0::bigint, 'a phase with no required evidence is not a pending gate');

SELECT test.as_superuser();
UPDATE public.product_lifecycle_phases SET state = 'in_progress', entered_at = now()
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'requirements';
SELECT test.as_user('alice');

SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'gate_ready'),
  0::bigint, 'missing PRD: not ready for the gate yet');

INSERT INTO public.phase_artifacts (phase_id, artifact_type, title, url)
SELECT id, 'prd', 'PRD v1', 'https://example.com/prd'
FROM public.product_lifecycle_phases
WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'requirements';

SELECT test.assert_eq(
  (SELECT subtitle FROM public.my_waiting_on() WHERE source = 'gate_ready'),
  'requirements', 'evidence filed: the gate waits on the owner');

SELECT test.as_user('bob');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'gate_ready'),
  0::bigint, 'not shown to someone who cannot advance it');

SELECT test.as_user('alice');
SELECT public.advance_lifecycle_phase(
  (SELECT id FROM public.product_lifecycle_phases
   WHERE product_id = '10000000-0000-4000-8000-000000000001' AND phase = 'requirements'),
  'complete');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'gate_ready'),
  0::bigint, 'advancing the phase resolves it');

-- ---------- proposal_pending ----------
SELECT test.as_superuser();
INSERT INTO public.messages (id, channel_id, author_id, body, kind)
SELECT '60000000-0000-4000-8000-000000000001', c.id,
       '00000000-0000-4000-8000-0000000000f1', 'I suggest a task.', 'agent'
FROM public.channels c WHERE c.product_id = '10000000-0000-4000-8000-000000000001';
INSERT INTO public.agent_proposals (id, message_id, channel_id, agent_id, product_id, action, payload, reasoning)
SELECT '70000000-0000-4000-8000-000000000001', m.id, m.channel_id,
       '00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-000000000001',
       'task_create', '{"title": "Write tests"}'::jsonb, 'Coverage is thin.'
FROM public.messages m WHERE m.id = '60000000-0000-4000-8000-000000000001';
SELECT test.as_user('alice');

SELECT test.assert_eq(
  (SELECT title || '/' || subtitle FROM public.my_waiting_on() WHERE source = 'proposal_pending'),
  'Scout/task_create', 'pending proposal on my product is waiting on me');

SELECT test.as_user('bob');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'proposal_pending'),
  0::bigint, 'not on someone else''s product');

SELECT test.as_user('alice');
SELECT public.decide_agent_proposal('70000000-0000-4000-8000-000000000001', 'reject', 'Not now');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'proposal_pending'),
  0::bigint, 'deciding the proposal resolves it');

-- ---------- mention_unreplied ----------
SELECT test.as_user('bob');
INSERT INTO public.messages (channel_id, author_id, body)
SELECT c.id, test.uid('bob'), 'Can you check this @alice?'
FROM public.channels c WHERE c.product_id = '10000000-0000-4000-8000-000000000002';

SELECT test.as_user('alice');
SELECT test.assert_eq(
  (SELECT title FROM public.my_waiting_on() WHERE source = 'mention_unreplied'),
  'Bob', 'mention without a reply is waiting on me');

-- A reply in the thread resolves it.
INSERT INTO public.messages (channel_id, parent_id, author_id, body)
SELECT channel_id, id, test.uid('alice'), 'On it.'
FROM public.messages WHERE body = 'Can you check this @alice?';
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on() WHERE source = 'mention_unreplied'),
  0::bigint, 'replying in the thread resolves the mention');

-- ---------- deal_stale / deal_closing ----------
INSERT INTO public.accounts (id, name, owner_id)
VALUES ('30000000-0000-4000-8000-000000000001', 'Acme', test.uid('alice'));
INSERT INTO public.deals (id, account_id, name, type, owner_id, next_action, next_action_date, expected_close)
VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   'Stale deal', 'consultation', test.uid('alice'), 'Chase', public.business_today() - 10, NULL),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   'Closing deal', 'consultation', test.uid('alice'), 'Sign', public.business_today() + 1,
   public.business_today() - extract(dow FROM public.business_today())::int + 3),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001',
   'Bob deal', 'consultation', test.uid('bob'), 'Chase', public.business_today() - 10, NULL),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001',
   'Next quarter', 'consultation', test.uid('alice'), 'Wait', public.business_today() + 1,
   public.business_today() + 60);

SELECT test.assert_eq(
  (SELECT source FROM public.my_waiting_on() WHERE record_id = '40000000-0000-4000-8000-000000000001'),
  'deal_stale', 'stale deal listed');
SELECT test.assert_eq(
  (SELECT source FROM public.my_waiting_on() WHERE record_id = '40000000-0000-4000-8000-000000000002'),
  'deal_closing', 'deal closing this week listed');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.my_waiting_on()
   WHERE record_id IN ('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004')),
  0::bigint, 'other owner and far-off deals excluded');

UPDATE public.deals SET next_action_date = public.business_today() + 2
WHERE id = '40000000-0000-4000-8000-000000000001';
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000002', 'closed_won', NULL, 'client');
SELECT test.assert_eq((SELECT count(*) FROM public.my_waiting_on()), 0::bigint,
  'every resolved item has left the list');

-- ---------- counts ----------
INSERT INTO public.product_tasks (product_id, title, assignee_id, due_date, created_by, status) VALUES
  (NULL, 'Overdue', test.uid('alice'), public.business_today() - 1, test.uid('alice'), 'pending'),
  (NULL, 'Today', test.uid('alice'), public.business_today(), test.uid('alice'), 'pending'),
  (NULL, 'Undated', test.uid('alice'), NULL, test.uid('alice'), 'pending'),
  (NULL, 'Done late', test.uid('alice'), public.business_today() - 5, test.uid('alice'), 'completed'),
  (NULL, 'Bob overdue', test.uid('bob'), public.business_today() - 1, test.uid('alice'), 'pending');

SELECT test.assert(
  (SELECT waiting = 0 AND overdue_tasks = 1 AND due_today_tasks = 1 AND badge = 1
   FROM public.my_work_counts()),
  'counts are scoped to the caller');

UPDATE public.deals SET next_action_date = public.business_today() - 10
WHERE id = '40000000-0000-4000-8000-000000000001';
SELECT test.assert_eq((SELECT badge FROM public.my_work_counts()), 2, 'badge = waiting + overdue');

-- ---------- privacy ----------
SELECT test.as_user('eve');
SELECT test.assert_eq((SELECT count(*) FROM public.my_waiting_on()), 0::bigint, 'inactive members get nothing');
