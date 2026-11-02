
import ProductTasksPanel, {type TaskMemberOption} from '@/components/products/ProductTasksPanel';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {ProductTask, TaskAttachment} from '@/lib/actions/tasks';

// The product's work: every task on it, with its attachments and whether the
// viewer is following each one.
export default async function TasksTab({
  productId,
  productName,
  currentUserId,
  members,
  disabled,
  locale
}: {
  productId: string;
  productName: string;
  currentUserId: string;
  members: TaskMemberOption[];
  disabled: boolean;
  locale: string;
}) {
  const insforge = await createInsForgeServerClient();

  const {data: tasks} = await insforge.database
    .from('product_tasks')
    .select(
      'id, product_id, parent_task_id, title, notes, due_date, assignee_id, status, workflow_status, position, created_by, completed_at, created_at, updated_at, release_id, completion_note, completed_by'
    )
    .eq('product_id', productId)
    .order('position', {ascending: true})
    .order('created_at', {ascending: true});

  const taskIds = (tasks ?? []).map((task) => task.id as string);
  const [{data: taskAttachments}, {data: watched}] = await Promise.all([
    taskIds.length > 0
      ? insforge.database
          .from('task_attachments')
          .select('id, task_id, storage_url, storage_key, file_name, mime_type, size_bytes, created_at')
          .in('task_id', taskIds)
          .order('created_at', {ascending: true})
      : Promise.resolve({data: []}),
    taskIds.length > 0
      ? insforge.database.from('task_watchers').select('task_id').eq('user_id', currentUserId).in('task_id', taskIds)
      : Promise.resolve({data: []})
  ]);

  const attachments = new Map<string, TaskAttachment[]>();
  for (const attachment of (taskAttachments ?? []) as unknown as TaskAttachment[]) {
    const list = attachments.get(attachment.task_id) ?? [];
    list.push(attachment);
    attachments.set(attachment.task_id, list);
  }
  const watchedIds = new Set((watched ?? []).map((row) => row.task_id as string));

  const workItems: ProductTask[] = ((tasks ?? []) as unknown as Omit<ProductTask, 'attachments' | 'is_watching'>[]).map(
    (task) => ({
      ...task,
      project_id: null,
      attachments: attachments.get(task.id) ?? [],
      is_watching: watchedIds.has(task.id)
    })
  );

  return (
    <ProductTasksPanel
      productId={productId}
      productName={productName}
      tasks={workItems}
      members={members}
      locale={locale}
      disabled={disabled}
    />
  );
}
