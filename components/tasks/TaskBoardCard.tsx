'use client';

import {ListTree, Paperclip} from 'lucide-react';
import {useTranslations} from 'next-intl';

import DueLabel from '@/components/tasks/DueLabel';
import type {RowTask, SubtaskProgress} from '@/components/tasks/TaskRow';
import Avatar from '@/components/ui/Avatar';

// A task on the board. Dragging moves it between statuses; a click on the
// title opens the task panel (the board's sensors need 6px of movement before
// a drag starts, so clicks pass through).
export default function TaskBoardCard({
  task,
  today,
  locale,
  progress,
  showAssignee = true,
  onOpen
}: {
  task: RowTask;
  today: string;
  locale: string;
  progress?: SubtaskProgress;
  showAssignee?: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('tasks');
  const completed = task.status === 'completed';

  return (
    <div className="space-y-2 rounded-md border border-hairline bg-panel p-3 transition-colors hover:border-accent/25">
      <button
        type="button"
        onClick={onOpen}
        className={`block w-full text-start text-sm font-medium leading-snug hover:text-accent ${
          completed ? 'text-muted line-through' : 'text-ink'
        }`}
      >
        {task.title}
      </button>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-faint">
        <span className="truncate">
          {task.product_name ?? (task.project_id ? t('all.projectTask') : t('all.general'))}
        </span>
        <DueLabel dueDate={task.due_date} today={today} locale={locale} completed={completed} />
        {progress && progress.total > 0 ? (
          <span className="inline-flex items-center gap-1 font-mono">
            <ListTree className="h-3 w-3" strokeWidth={1.75} />
            {progress.done}/{progress.total}
          </span>
        ) : null}
        {task.attachments.length > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3 w-3" strokeWidth={1.75} />
            {task.attachments.length}
          </span>
        ) : null}
        {showAssignee ? (
          <span className="ms-auto">
            <Avatar name={task.assignee_name} size="xs" title={task.assignee_name ?? t('task.unassigned')} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
