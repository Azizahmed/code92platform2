'use client';

import {CalendarDays, CornerDownRight, Pencil} from 'lucide-react';
import {useTranslations} from 'next-intl';

import ProductChip from '@/components/my-work/ProductChip';
import {dueState, formatDay} from '@/lib/dates';
import {firstLine, type MyTask} from '@/lib/my-work';

const DUE_TONES = {
  overdue: 'text-amber',
  today: 'text-accent',
  upcoming: 'text-muted',
  none: 'text-faint'
} as const;

// Kanban card: product chip, due date, first line of the description.
export default function TaskCard({
  task,
  today,
  locale,
  onEdit
}: {
  task: MyTask;
  today: string;
  locale: string;
  onEdit: () => void;
}) {
  const t = useTranslations('myWork');
  const done = task.status === 'completed';
  const state = done ? 'none' : dueState(task.due_date, today);
  const summary = firstLine(task.notes);

  return (
    <article className="group cursor-grab rounded-md border border-hairline bg-bg px-3 py-2.5 transition-colors hover:border-accent/30 active:cursor-grabbing">
      <div className="flex items-start justify-between gap-2">
        <h3 className={`min-w-0 text-sm font-medium leading-snug ${done ? 'text-muted line-through' : 'text-ink'}`}>
          {task.title}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          // Keep the drag sensor from swallowing the click.
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={t('task.edit')}
          className="shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-raised hover:text-ink focus:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </div>
      {summary ? <p className="mt-1 line-clamp-2 text-xs text-muted">{summary}</p> : null}
      {task.parent_title ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-faint">
          <CornerDownRight className="h-3 w-3 rtl:rotate-180" strokeWidth={1.75} />
          <span className="truncate">{task.parent_title}</span>
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-faint">
        <ProductChip name={task.product_name} logoUrl={task.product_logo_url} generalLabel={t('general')} />
        {task.due_date ? (
          <span className={`inline-flex shrink-0 items-center gap-1 font-mono ${DUE_TONES[state]}`}>
            <CalendarDays className="h-3 w-3" strokeWidth={1.75} />
            {formatDay(task.due_date, locale)}
          </span>
        ) : null}
      </div>
    </article>
  );
}
