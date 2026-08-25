import {ListTodo} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import AllTasksBoard, {
  type AllTaskItem,
  type TaskProductOption
} from '@/components/tasks/AllTasksBoard';
import type {TaskMemberOption} from '@/components/products/ProductTasksPanel';
import {requireActiveMember} from '@/lib/auth';
import type {
  ProductTask,
  TaskAttachment
} from '@/lib/actions/tasks';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export default async function AllTasksPage({
  params
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  const insforge = await createInsForgeServerClient();

  const [{user}, t, [{data: tasks}, {data: products}, {data: members}]] =
    await Promise.all([
      requireActiveMember(),
      getTranslations('tasks'),
      Promise.all([
        insforge.database
          .from('product_tasks')
          .select(
            'id, product_id, parent_task_id, title, notes, due_date, assignee_id, status, position, created_by, completed_at, created_at, updated_at, release_id, completion_note, completed_by, lifecycle_phase'
          )
          .order('due_date', {ascending: true, nullsFirst: false})
          .order('created_at', {ascending: false}),
        insforge.database
          .from('products')
          .select('id, name, logo_url, archived_at')
          .order('name'),
        insforge.database
          .from('team_members')
          .select('user_id, display_name')
          .eq('is_active', true)
          .order('display_name')
      ])
    ]);

  const taskRows = (tasks ?? []) as unknown as Omit<
    ProductTask,
    'attachments' | 'is_watching'
  >[];
  const taskIds = taskRows.map((task) => task.id);
  const [{data: attachments}, {data: watched}] =
    taskIds.length > 0
      ? await Promise.all([
          insforge.database
            .from('task_attachments')
            .select(
              'id, task_id, storage_url, storage_key, file_name, mime_type, size_bytes, created_at'
            )
            .in('task_id', taskIds)
            .order('created_at', {ascending: true}),
          insforge.database
            .from('task_watchers')
            .select('task_id')
            .eq('user_id', user.id)
            .in('task_id', taskIds)
        ])
      : [{data: []}, {data: []}];

  const attachmentsByTask = new Map<string, TaskAttachment[]>();
  for (const attachment of (attachments ??
    []) as unknown as TaskAttachment[]) {
    const list = attachmentsByTask.get(attachment.task_id) ?? [];
    list.push(attachment);
    attachmentsByTask.set(attachment.task_id, list);
  }

  const watchedTaskIds = new Set(
    (watched ?? []).map((row) => row.task_id as string)
  );
  const productMap = new Map(
    (products ?? []).map((product) => [
      product.id as string,
      {
        name: product.name as string,
        logoUrl: (product.logo_url as string | null) ?? null,
        archivedAt: (product.archived_at as string | null) ?? null
      }
    ])
  );
  const memberMap = new Map(
    (members ?? []).map((member) => [
      member.user_id as string,
      member.display_name as string
    ])
  );
  const taskTitleMap = new Map(
    taskRows.map((task) => [task.id, task.title])
  );

  // A general task has no product, and a product task whose product was hard
  // deleted has none either. Both are kept: this is the only page that lists
  // them, so filtering here would make them unreachable rather than tidy.
  const allTasks: AllTaskItem[] = taskRows.map((task) => {
      const product = task.product_id
        ? productMap.get(task.product_id) ?? null
        : null;
      return {
        ...task,
        attachments: attachmentsByTask.get(task.id) ?? [],
        is_watching: watchedTaskIds.has(task.id),
        product_name: product?.name ?? null,
        product_logo_url: product?.logoUrl ?? null,
        product_archived_at: product?.archivedAt ?? null,
        assignee_name: task.assignee_id
          ? memberMap.get(task.assignee_id) ?? null
          : null,
        parent_title: task.parent_task_id
          ? taskTitleMap.get(task.parent_task_id) ?? null
          : null,
        completed_by_name: task.completed_by
          ? memberMap.get(task.completed_by) ?? null
          : null
      };
    });

  const productOptions: TaskProductOption[] = (products ?? [])
    .filter((product) => !product.archived_at)
    .map((product) => ({
      id: product.id as string,
      name: product.name as string
    }));

  const memberOptions: TaskMemberOption[] = (members ?? []).map((member) => ({
    userId: member.user_id as string,
    displayName: member.display_name as string
  }));

  return (
    <section className="space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <h1 className="text-xl font-semibold">{t('all.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('all.subtitle')}</p>
      </header>

      <AllTasksBoard
        tasks={allTasks}
        products={productOptions}
        members={memberOptions}
        currentUserId={user.id}
        locale={locale}
      />
    </section>
  );
}
