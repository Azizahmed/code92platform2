import {Bell, Inbox} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import MyWorkView, {
  type MyWorkTask,
  type WaitingItem
} from '@/components/my-work/MyWorkView';
import {Link} from '@/i18n/navigation';
import type {ProductTask, TaskAttachment} from '@/lib/actions/tasks';
import {requireActiveMember} from '@/lib/auth';
import {businessDate} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';

// Done cards stay on the board for two weeks after completion.
const DONE_WINDOW_DAYS = 14;

export default async function MyWorkPage({
  params,
  searchParams
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{tab?: string}>;
}) {
  const [{locale}, {tab}] = await Promise.all([params, searchParams]);
  const insforge = await createInsForgeServerClient();
  const doneSince = new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString();

  // One wave. Only the task query needs the caller's id, so it alone is
  // chained behind requireActiveMember() — whose get_me() call is cached per
  // request, so the chain costs no second identity round trip — while
  // translations, products, members and the waiting list start immediately.
  const tasksQuery = requireActiveMember().then(({user: me}) =>
    insforge.database
      .from('product_tasks')
      .select(
        'id, product_id, parent_task_id, title, notes, due_date, assignee_id, status, workflow_status, position, created_by, completed_at, created_at, updated_at, release_id, completion_note, completed_by, lifecycle_phase'
      )
      .eq('assignee_id', me.id)
      .or(`status.eq.pending,completed_at.gte.${doneSince}`)
      .order('due_date', {ascending: true, nullsFirst: false})
      .limit(500)
  );

  const [{user}, t, {data: tasks}, {data: products}, {data: members}, {data: waiting}] =
    await Promise.all([
      requireActiveMember(),
      getTranslations('myWork'),
      tasksQuery,
      insforge.database
        .from('products')
        .select('id, name, logo_url, archived_at')
        .order('name'),
      insforge.database
        .from('team_members')
        .select('user_id, display_name')
        .eq('is_active', true)
        .order('display_name'),
      insforge.database.rpc('my_waiting_on')
    ]);

  const rows = (tasks ?? []) as unknown as Omit<
    MyWorkTask,
    'attachments' | 'is_watching' | 'product_name' | 'product_logo_url' | 'parent_title'
  >[];
  const taskIds = rows.map((task) => task.id);

  // The editor shows a task's attachments; fetched only for the tasks listed.
  const [{data: attachments}, {data: watched}] =
    taskIds.length > 0
      ? await Promise.all([
          insforge.database
            .from('task_attachments')
            .select('id, task_id, storage_url, storage_key, file_name, mime_type, size_bytes, created_at')
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
  for (const attachment of (attachments ?? []) as unknown as TaskAttachment[]) {
    const list = attachmentsByTask.get(attachment.task_id) ?? [];
    list.push(attachment);
    attachmentsByTask.set(attachment.task_id, list);
  }
  const watchedIds = new Set((watched ?? []).map((row) => row.task_id as string));
  const productMap = new Map((products ?? []).map((product) => [product.id as string, product]));
  const titleById = new Map(rows.map((task) => [task.id, task.title]));

  const myTasks: MyWorkTask[] = rows.map((task) => {
    const product = task.product_id ? productMap.get(task.product_id) : undefined;
    return {
      ...(task as Omit<ProductTask, 'attachments' | 'is_watching'> & {workflow_status: MyWorkTask['workflow_status']}),
      attachments: attachmentsByTask.get(task.id) ?? [],
      is_watching: watchedIds.has(task.id),
      product_name: (product?.name as string | undefined) ?? null,
      product_logo_url: (product?.logo_url as string | null | undefined) ?? null,
      parent_title: task.parent_task_id ? titleById.get(task.parent_task_id) ?? null : null
    };
  });

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-accent" strokeWidth={1.75} />
            <h1 className="text-xl font-semibold">{t('title')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Link
          href="/settings#notifications"
          className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Bell className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t('settingsLink')}
        </Link>
      </header>

      <MyWorkView
        initialTab={tab === 'waiting' ? 'waiting' : 'assigned'}
        tasks={myTasks}
        waiting={(waiting ?? []) as WaitingItem[]}
        products={(products ?? [])
          .filter((product) => !product.archived_at)
          .map((product) => ({id: product.id as string, name: product.name as string}))}
        members={(members ?? []).map((member) => ({
          userId: member.user_id as string,
          displayName: member.display_name as string
        }))}
        today={businessDate()}
        locale={locale}
      />
    </section>
  );
}
