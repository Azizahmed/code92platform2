'use client';

import Image from 'next/image';
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  CornerDownRight,
  ImageIcon,
  ListFilter,
  ListTodo,
  Search,
  UserRound
} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useMemo, useState, useTransition} from 'react';

import {Link, useRouter} from '@/i18n/navigation';
import type {ProductTask, TaskStatus} from '@/lib/actions/tasks';
import {updateTaskAction} from '@/lib/actions/tasks';

export type AllTaskItem = ProductTask & {
  product_name: string;
  product_logo_url: string | null;
  product_archived_at: string | null;
  assignee_name: string | null;
  parent_title: string | null;
};

export type TaskProductOption = {
  id: string;
  name: string;
};

type Scope = 'open' | 'all' | 'completed';

const SELECT_CLASS =
  'rounded-md border border-hairline bg-bg px-2.5 py-2 text-xs text-muted outline-none transition-colors focus:border-accent/50';

export default function AllTasksBoard({
  tasks,
  products,
  currentUserId,
  locale
}: {
  tasks: AllTaskItem[];
  products: TaskProductOption[];
  currentUserId: string;
  locale: string;
}) {
  const t = useTranslations('tasks');
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('open');
  const [productId, setProductId] = useState('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  const openCount = tasks.filter((task) => task.status === 'pending').length;
  const completedCount = tasks.length - openCount;
  const overdueCount = tasks.filter(
    (task) =>
      task.status === 'pending' &&
      task.due_date !== null &&
      new Date(`${task.due_date}T00:00:00`).getTime() < today
  ).length;
  const dueTodayCount = tasks.filter(
    (task) =>
      task.status === 'pending' &&
      task.due_date !== null &&
      new Date(`${task.due_date}T00:00:00`).getTime() === today
  ).length;

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return tasks.filter((task) => {
      if (scope !== 'all' && task.status !== scope.replace('open', 'pending')) {
        return false;
      }
      if (productId !== 'all' && task.product_id !== productId) return false;
      if (mineOnly && task.assignee_id !== currentUserId) return false;
      if (
        normalizedQuery &&
        ![
          task.title,
          task.notes ?? '',
          task.product_name,
          task.assignee_name ?? '',
          task.parent_title ?? ''
        ]
          .join(' ')
          .toLocaleLowerCase(locale)
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });
  }, [currentUserId, locale, mineOnly, productId, query, scope, tasks]);

  function toggle(task: AllTaskItem) {
    setError(null);
    setPendingTaskId(task.id);
    startTransition(async () => {
      const status: TaskStatus =
        task.status === 'completed' ? 'pending' : 'completed';
      const result = await updateTaskAction(task.id, {
        title: task.title,
        notes: task.notes,
        dueDate: task.due_date,
        assigneeId: task.assignee_id,
        status
      });
      if (!result.ok) setError(result.error);
      setPendingTaskId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            key: 'open',
            value: openCount,
            icon: Circle,
            tone: 'text-ink'
          },
          {
            key: 'dueToday',
            value: dueTodayCount,
            icon: CalendarDays,
            tone: 'text-accent'
          },
          {
            key: 'overdue',
            value: overdueCount,
            icon: CalendarDays,
            tone: 'text-amber'
          },
          {
            key: 'completed',
            value: completedCount,
            icon: CheckCircle2,
            tone: 'text-muted'
          }
        ].map(({key, value, icon: Icon, tone}) => (
          <div
            key={key}
            className="rounded-lg border border-hairline bg-panel px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-widest text-faint">
                {t(`all.stats.${key}`)}
              </span>
              <Icon className={`h-4 w-4 ${tone}`} strokeWidth={1.75} />
            </div>
            <div className={`mt-2 font-mono text-2xl font-medium ${tone}`}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-panel p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
            strokeWidth={1.75}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('all.searchPlaceholder')}
            className="w-full rounded-md border border-hairline bg-bg py-2 ps-9 pe-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
        </div>

        <div className="flex items-center gap-1 rounded-md border border-hairline bg-bg p-1">
          {(['open', 'all', 'completed'] as Scope[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                scope === value
                  ? 'bg-raised text-ink'
                  : 'text-faint hover:text-muted'
              }`}
            >
              {t(`all.scope.${value}`)}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-muted">
          <ListFilter className="h-3.5 w-3.5 text-faint" strokeWidth={1.75} />
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="all">{t('all.allProducts')}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-hairline bg-bg px-2.5 py-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(event) => setMineOnly(event.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          {t('all.assignedToMe')}
        </label>
      </div>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-16 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
            <ListTodo className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-3 text-sm font-medium">{t('all.emptyTitle')}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">
            {t('all.emptyBody')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-hairline bg-raised/30 px-4 py-2.5 text-[10px] uppercase tracking-widest text-faint lg:grid-cols-[minmax(0,1fr)_190px_150px_auto]">
            <span>{t('all.columns.task')}</span>
            <span className="hidden lg:block">{t('all.columns.assignee')}</span>
            <span className="hidden lg:block">{t('all.columns.due')}</span>
            <span>{t('all.columns.status')}</span>
          </div>

          <ul>
            {visible.map((task) => {
              const completed = task.status === 'completed';
              const dueTime = task.due_date
                ? new Date(`${task.due_date}T00:00:00`).getTime()
                : null;
              const overdue = !completed && dueTime !== null && dueTime < today;
              const dueToday = !completed && dueTime === today;
              const formattedDate = task.due_date
                ? new Intl.DateTimeFormat(locale, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  }).format(new Date(`${task.due_date}T00:00:00`))
                : null;

              return (
                <li
                  key={task.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline px-4 py-3 transition-colors last:border-0 hover:bg-raised/35 lg:grid-cols-[minmax(0,1fr)_190px_150px_auto]"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(task)}
                      disabled={pendingTaskId === task.id}
                      aria-label={
                        completed ? t('task.reopen') : t('task.complete')
                      }
                      className={`mt-0.5 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                        completed
                          ? 'text-accent'
                          : 'text-faint hover:text-accent'
                      }`}
                    >
                      {completed ? (
                        <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
                      ) : (
                        <Circle className="h-5 w-5" strokeWidth={1.75} />
                      )}
                    </button>

                    <div className="min-w-0">
                      <Link
                        href={`/products/${task.product_id}#task-${task.id}`}
                        className={`block truncate text-sm font-medium transition-colors hover:text-accent ${
                          completed ? 'text-muted line-through' : 'text-ink'
                        }`}
                      >
                        {task.title}
                      </Link>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded border border-hairline bg-raised font-mono text-[8px]">
                            {task.product_logo_url ? (
                              <Image
                                src={task.product_logo_url}
                                alt={task.product_name}
                                fill
                                unoptimized
                                sizes="16px"
                                className="object-cover"
                              />
                            ) : (
                              task.product_name.slice(0, 1).toUpperCase()
                            )}
                          </span>
                          {task.product_name}
                        </span>
                        {task.parent_title ? (
                          <span className="inline-flex items-center gap-1">
                            <CornerDownRight
                              className="h-3 w-3 rtl:rotate-180"
                              strokeWidth={1.75}
                            />
                            {task.parent_title}
                          </span>
                        ) : null}
                        {task.attachments.length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" strokeWidth={1.75} />
                            {t('media.imageCount', {
                              count: task.attachments.length
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="hidden min-w-0 items-center gap-2 text-xs text-muted lg:flex">
                    <UserRound
                      className="h-3.5 w-3.5 shrink-0 text-faint"
                      strokeWidth={1.75}
                    />
                    <span className="truncate">
                      {task.assignee_name ?? t('task.unassigned')}
                    </span>
                  </div>

                  <div
                    className={`hidden font-mono text-xs lg:block ${
                      overdue
                        ? 'text-amber'
                        : dueToday
                          ? 'text-accent'
                          : formattedDate
                            ? 'text-muted'
                            : 'text-faint'
                    }`}
                  >
                    {formattedDate ?? t('all.noDueDate')}
                  </div>

                  <span
                    className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wider ${
                      completed
                        ? 'border-accent/20 bg-accent/10 text-accent'
                        : overdue
                          ? 'border-amber/30 bg-amber/10 text-amber'
                          : 'border-hairline bg-raised text-muted'
                    }`}
                  >
                    {completed
                      ? t('all.status.completed')
                      : overdue
                        ? t('all.status.overdue')
                        : t('all.status.open')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
