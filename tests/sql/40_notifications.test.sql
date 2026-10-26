-- 0.2 notifications on the existing notifications table: deal/account events,
-- due/overdue generation, owner-always-emailed, preferences, idempotency,
-- the kanban → task_completed path, and access control.

CREATE FUNCTION test.n(p_type TEXT, p_who TEXT)
RETURNS BIGINT LANGUAGE sql AS $$
  SELECT count(*) FROM public.notifications
  WHERE type = p_type AND user_id = test.uid(p_who)
$$;
CREATE FUNCTION test.email(p_type TEXT, p_who TEXT)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT string_agg(DISTINCT email_state, ',') FROM public.notifications
  WHERE type = p_type AND user_id = test.uid(p_who)
$$;

-- ---------- assigned ----------
SELECT test.as_user('alice');
INSERT INTO public.accounts (id, name, owner_id)
VALUES ('30000000-0000-4000-8000-000000000001', 'Acme', test.uid('alice'));
UPDATE public.accounts SET owner_id = test.uid('bob') WHERE id = '30000000-0000-4000-8000-000000000001';

INSERT INTO public.deals (id, account_id, name, type, owner_id, next_action, next_action_date)
VALUES ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        'Big deal', 'consultation', test.uid('bob'), 'Call', public.business_today());

-- Clients cannot write notifications or run the generators.
SELECT test.assert_raises(
  $$INSERT INTO public.notifications (user_id, type, title) VALUES (test.uid('bob'), 'deal_due', 'x')$$,
  'permission denied', 'notifications are trigger-written only');
SELECT test.assert_raises($$SELECT public.notification_enqueue_due()$$, 'permission denied', 'due job is server-only');
SELECT test.assert_raises(
  $$SELECT public.enqueue_notification(ARRAY[test.uid('bob')], 'deal_due', 't', 'b', NULL)$$,
  'permission denied', 'generic fan-out is server-only');

-- Watching is self-service only.
SELECT test.assert_raises(
  $$INSERT INTO public.deal_watchers (deal_id, user_id) VALUES ('40000000-0000-4000-8000-000000000001', test.uid('admin'))$$,
  'row-level security', 'cannot sign someone else up as a watcher');

SELECT test.as_user('admin');
INSERT INTO public.deal_watchers (deal_id, user_id)
VALUES ('40000000-0000-4000-8000-000000000001', test.uid('admin'));
INSERT INTO public.account_watchers (account_id, user_id)
VALUES ('30000000-0000-4000-8000-000000000001', test.uid('admin'));

SELECT test.as_superuser();
SELECT test.assert_eq(test.n('account_assigned', 'alice'), 0::bigint, 'creating your own account: no self-notification');
SELECT test.assert_eq(test.n('account_assigned', 'bob'), 1::bigint, 'reassigned account notifies the new owner');
SELECT test.assert_eq(test.n('deal_assigned', 'bob'), 1::bigint, 'deal owner notified on create');
SELECT test.assert_eq(test.email('deal_assigned', 'bob'), 'skipped', 'email stays opt-in for assignments');
SELECT test.assert(
  (SELECT body LIKE 'Alice made you the owner of a deal with Acme' AND title = 'Big deal'
     AND deal_id = '40000000-0000-4000-8000-000000000001'
     AND account_id = '30000000-0000-4000-8000-000000000001'
   FROM public.notifications WHERE type = 'deal_assigned' AND user_id = test.uid('bob')),
  'one line: what changed and who did it, pointing at the record');

-- ---------- preferences ----------
-- Alice opts in to email but switches due reminders off; admin opts in fully.
INSERT INTO public.notification_preferences (user_id, email_enabled, email_on_due)
VALUES (test.uid('alice'), true, false);
INSERT INTO public.notification_preferences (user_id, email_enabled)
VALUES (test.uid('admin'), true);

-- ---------- due / overdue ----------
SELECT test.as_user('alice');
INSERT INTO public.product_tasks (id, product_id, title, assignee_id, due_date, created_by)
VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
        'Prepare demo', test.uid('bob'), public.business_today(), test.uid('alice'));

SET ROLE project_admin;
SELECT public.notification_enqueue_due();
SELECT public.notification_enqueue_due();  -- a re-run files nothing new
RESET ROLE;

SELECT test.assert_eq(test.n('task_due', 'bob'), 1::bigint, 'assignee told on the due date, once');
SELECT test.assert_eq(test.email('task_due', 'bob'), 'pending', 'owner due reminder is always emailed, even with email off');
SELECT test.assert_eq(test.n('task_due', 'alice'), 1::bigint, 'the author watches the task and is told too');
SELECT test.assert_eq(test.email('task_due', 'alice'), 'skipped', 'a watcher''s due switch is respected');
SELECT test.assert_eq(test.n('deal_due', 'bob'), 1::bigint, 'deal owner told on the next-action date');
SELECT test.assert_eq(test.email('deal_due', 'bob'), 'pending', 'deal owner due reminder always emailed');
SELECT test.assert_eq(test.email('deal_due', 'admin'), 'pending', 'opted-in watcher emailed');

-- The next day both are overdue, exactly once each.
SET ROLE project_admin;
SELECT public.notification_enqueue_due(public.business_today() + 1);
SELECT public.notification_enqueue_due(public.business_today() + 1);
RESET ROLE;
SELECT test.assert_eq(test.n('task_overdue', 'bob'), 1::bigint, 'task overdue once');
SELECT test.assert_eq(test.n('deal_overdue', 'bob'), 1::bigint, 'deal overdue once');
SELECT test.assert(
  (SELECT body LIKE 'Overdue since %' FROM public.notifications
   WHERE type = 'task_overdue' AND user_id = test.uid('bob')),
  'overdue body names the date');

-- Completed tasks and closed deals are never chased.
SELECT test.as_user('bob');
UPDATE public.product_tasks SET workflow_status = 'done' WHERE id = '20000000-0000-4000-8000-000000000001';

SELECT test.as_superuser();
SELECT test.assert_eq(test.n('task_completed', 'alice'), 1::bigint,
  'moving the card to Done completes the task through the existing trigger');
SET ROLE project_admin;
SELECT public.notification_enqueue_due(public.business_today() + 2);
RESET ROLE;
SELECT test.assert_eq(test.n('task_overdue', 'bob'), 1::bigint, 'a completed task is not chased again');

-- ---------- closed ----------
SELECT test.as_user('alice');
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000001', 'closed_lost', 'No budget');
SELECT test.as_user('bob');
UPDATE public.accounts SET archived_at = now() WHERE id = '30000000-0000-4000-8000-000000000001';

SELECT test.as_superuser();
SELECT test.assert_eq(test.n('deal_closed', 'bob'), 1::bigint, 'deal owner told when it closes');
SELECT test.assert_eq(test.n('deal_closed', 'admin'), 1::bigint, 'deal watcher told when it closes');
SELECT test.assert_eq(test.email('deal_closed', 'admin'), 'pending', 'closed email follows the watcher''s switch');
SELECT test.assert(
  (SELECT body = 'Alice closed this deal as lost: No budget' FROM public.notifications
   WHERE type = 'deal_closed' AND user_id = test.uid('bob')),
  'closed body carries the reason');
SELECT test.assert_eq(test.n('account_archived', 'bob'), 0::bigint, 'archiving your own account: no self-notification');
SELECT test.assert_eq(test.n('account_archived', 'admin'), 1::bigint, 'account watcher told on archive');

-- ---------- reading ----------
SELECT test.as_user('bob');
SELECT test.assert(
  (SELECT bool_and(user_id = test.uid('bob')) FROM public.notifications),
  'a member reads only their own notifications');
SELECT test.assert_raises(
  $$UPDATE public.notifications SET email_state = 'pending'$$,
  'permission denied', 'recipients cannot re-queue mail');
