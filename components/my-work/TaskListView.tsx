'use client';

import {CheckCircle2, Circle, CornerDownRight, Pencil} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useMemo} from 'react';

import ProductChip from '@/components/my-work/ProductChip';
import {Link} from '@/i18n/navigation';
import {dueState, formatDay} from '@/lib/dates';
import {groupByProduct, type MyTask} from '@/lib/my-work';

const STATUS_CHIP = {
  todo: 'border-hairline bg-raised text-muted',
  in_progress: 'border-accent/30 bg-accent/10 text-accent',
  blocked: 'border-danger/30 bg-danger/10 text-danger',
  done: 'border-hairline bg-raised text-faint'
} as const;

// Open tasks grouped by product (General last), due date ascending, undated
// last. Completing a row moves it to the kanban's Done column.
export default function TaskListView<T extends MyTask>({
  tasks,
  today,
  locale,
  onToggle,
  onEdit
}: {
  tasks: T[];
  today: string;
  locale: string;
  onToggle: (task: T) => void;
  onEdit: (task: T) => void;
}) {
  const t = useTranslations('myWork');
  const groups = useMemo(
    () => groupByProduct(tasks.filter((task) => task.status === 'pending'), locale),
    [tasks, locale]
  );

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-10 text-center text-sm text-muted">
        {t('empty.allDone')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.productId ?? 'general'} className="overflow-hidden rounded-lg border border-hairline bg-panel">
          <header className="flex items-center justify-between gap-3 border-b border-hairline bg-raised/30 px-4 py-2.5">
            <span className="flex min-w-0 items-center text-xs font-medium text-muted">
              {group.productId ? (
                <Link href={`/products/${group.productId}`} className="min-w-0 transition-colors hover:text-accent">
                  <ProductChip name={group.productName} logoUrl={group.tasks[0]?.product_logo_url ?? null} generalLabel={t('general')} />
                </Link>
              ) : (
                <ProductChip name={null} logoUrl={null} generalLabel={t('general')} />
              )}
            </span>
            <span className="font-mono text-[11px] text-faint">{group.tasks.length}</span>
          </header>
          <ul>
            {group.tasks.map((task) => {
              const state = dueState(task.due_date, today);
              return (
                <li
                  key={task.id}
                  className="group flex items-center gap-3 border-b border-hairline px-4 py-2.5 transition-colors last:border-0 hover:bg-raised/35"
                >
                  <button
                    type="button"
                    onClick={() => onToggle(task)}
                    aria-label={t('task.complete')}
                    className="shrink-0 text-faint transition-colors hover:text-accent"
                  >
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5 text-accent" strokeWidth={1.75} />
                    ) : (
                      <Circle className="h-5 w-5" strokeWidth={1.75} />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    {task.product_id ? (
                      <Link
                        href={`/products/${task.product_id}#task-${task.id}`}
                        className="block truncate text-sm text-ink transition-colors hover:text-accent"
                      >
                        {task.title}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onEdit(task)}
                        className="block max-w-full truncate text-start text-sm text-ink transition-colors hover:text-accent"
                      >
                        {task.title}
                      </button>
                    )}
                    {task.parent_title ? (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-faint">
                        <CornerDownRight className="h-3 w-3 rtl:rotate-180" strokeWidth={1.75} />
                        <span className="truncate">{task.parent_title}</span>
                      </span>
                    ) : null}
                  </div>

                  {task.workflow_status !== 'todo' ? (
                    <span className={`hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider sm:inline ${STATUS_CHIP[task.workflow_status]}`}>
                      {t(`status.${task.workflow_status}`)}
                    </span>
                  ) : null}

                  <span
                    className={`shrink-0 font-mono text-xs ${
                      state === 'overdue' ? 'text-amber' : state === 'today' ? 'text-accent' : state === 'none' ? 'text-faint' : 'text-muted'
                    }`}
                  >
                    {task.due_date
                      ? state === 'today'
                        ? t('task.today')
                        : formatDay(task.due_date, locale)
                      : t('task.noDueDate')}
                  </span>

                  <button
                    type="button"
                    onClick={() => onEdit(task)}
                    aria-label={t('task.edit')}
                    className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-raised hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
