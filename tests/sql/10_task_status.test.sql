-- Task workflow_status <-> status sync and the General (NULL product) backlog.

SELECT test.as_user('alice');

-- General task: no product, defaults to todo/pending.
INSERT INTO public.product_tasks (id, product_id, title, assignee_id, created_by)
VALUES ('20000000-0000-4000-8000-000000000001', NULL, 'General task',
        test.uid('alice'), test.uid('alice'));

SELECT test.assert_eq(
  (SELECT workflow_status FROM public.product_tasks WHERE id = '20000000-0000-4000-8000-000000000001'),
  'todo', 'new task defaults to todo');

-- General subtask under a General parent is allowed.
INSERT INTO public.product_tasks (product_id, parent_task_id, title, created_by)
VALUES (NULL, '20000000-0000-4000-8000-000000000001', 'General subtask', test.uid('alice'));

-- Kanban moves.
UPDATE public.product_tasks SET workflow_status = 'in_progress'
WHERE id = '20000000-0000-4000-8000-000000000001';
SELECT test.assert_eq(
  (SELECT status FROM public.product_tasks WHERE id = '20000000-0000-4000-8000-000000000001'),
  'pending', 'in_progress keeps status pending');

UPDATE public.product_tasks SET workflow_status = 'blocked'
WHERE id = '20000000-0000-4000-8000-000000000001';

UPDATE public.product_tasks SET workflow_status = 'done'
WHERE id = '20000000-0000-4000-8000-000000000001';
SELECT test.assert(
  (SELECT status = 'completed' AND completed_at IS NOT NULL
   FROM public.product_tasks WHERE id = '20000000-0000-4000-8000-000000000001'),
  'moving to done completes the task');

UPDATE public.product_tasks SET workflow_status = 'todo'
WHERE id = '20000000-0000-4000-8000-000000000001';
SELECT test.assert(
  (SELECT status = 'pending' AND completed_at IS NULL
   FROM public.product_tasks WHERE id = '20000000-0000-4000-8000-000000000001'),
  'moving out of done reopens the task');

-- Old screens write status only.
INSERT INTO public.product_tasks (id, product_id, title, created_by)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
        'Product task', test.uid('alice'));
UPDATE public.product_tasks SET workflow_status = 'in_progress'
WHERE id = '20000000-0000-4000-8000-000000000002';

UPDATE public.product_tasks SET status = 'completed'
WHERE id = '20000000-0000-4000-8000-000000000002';
SELECT test.assert_eq(
  (SELECT workflow_status FROM public.product_tasks WHERE id = '20000000-0000-4000-8000-000000000002'),
  'done', 'completing via status moves card to done');

UPDATE public.product_tasks SET status = 'pending'
WHERE id = '20000000-0000-4000-8000-000000000002';
SELECT test.assert_eq(
  (SELECT workflow_status FROM public.product_tasks WHERE id = '20000000-0000-4000-8000-000000000002'),
  'todo', 'reopening via status moves card back to todo');

-- Subtask of a product task cannot be General.
SELECT test.assert_raises(
  $$INSERT INTO public.product_tasks (product_id, parent_task_id, title, created_by)
    VALUES (NULL, '20000000-0000-4000-8000-000000000002', 'x', test.uid('alice'))$$,
  'same product', 'subtask product must match parent');

-- Invalid workflow status rejected.
SELECT test.assert_raises(
  $$UPDATE public.product_tasks SET workflow_status = 'archived'
    WHERE id = '20000000-0000-4000-8000-000000000002'$$,
  'check', 'workflow_status is constrained');

-- Inactive members cannot see tasks.
SELECT test.as_user('eve');
SELECT test.assert_eq((SELECT count(*) FROM public.product_tasks), 0::bigint,
  'inactive member sees no tasks');
