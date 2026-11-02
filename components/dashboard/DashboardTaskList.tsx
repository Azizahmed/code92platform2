'use client';

import {CheckCircle2, Circle} from 'lucide-react';
import {useLocale} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import DueLabel from '@/components/tasks/DueLabel';
import Avatar from '@/components/ui/Avatar';
import {openTaskDrawer} from '@/lib/task-drawer';

type Row = {
  id: string;
  title: string;
  due_date: string | null;
  completed_at: string | null;
  completion_note: string | null;
  product_name: string | null;
  person: string | null;
};

// A short task list on the dashboard. Each row opens the task panel in place.
// "due": what is coming up, with the owner. "done": what just finished, with
// who finished it and the first line of what they wrote.
export default function DashboardTaskList({
  tasks,
  mode,
  today,
  empty
}: {
  tasks: Row[];
  mode: 'due' | 'done';
  today: string;
  empty: string;
}) {
  const locale = useLocale();

  if (tasks.length === 0) {
    return <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-sm text-faint">{empty}</p>;
  }

  return (
    <ul className="divide-y divide-hairline">
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            onClick={() => openTaskDrawer(task.id)}
            className="flex w-full items-start gap-3 rounded-md px-1 py-2.5 text-start transition-colors hover:bg-raised/40"
          >
            {mode === 'done' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{task.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                {task.product_name ? <span className="truncate">{task.product_name}</span> : null}
                {mode === 'done' && task.completion_note ? (
                  <span className="line-clamp-1 text-muted">“{task.completion_note.split('\n')[0]}”</span>
                ) : null}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
              {mode === 'due' ? (
                <DueLabel dueDate={task.due_date} today={today} locale={locale} showIcon={false} />
              ) : task.completed_at ? (
                <span className="text-faint">
                  <RelativeTime date={task.completed_at} />
                </span>
              ) : null}
              {task.person || mode === 'due' ? <Avatar name={task.person} size="xs" /> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
