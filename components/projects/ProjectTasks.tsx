'use client';

import {CheckCircle2, Circle} from 'lucide-react';
import {useTranslations} from 'next-intl';

import DueLabel from '@/components/tasks/DueLabel';
import StatusMenu from '@/components/tasks/StatusMenu';
import TaskQuickAdd from '@/components/tasks/TaskQuickAdd';
import {useTaskActions, useTaskOverrides} from '@/components/tasks/useTaskActions';
import Avatar from '@/components/ui/Avatar';
import {businessDate} from '@/lib/dates';
import {workflowOf, type WorkflowStatus} from '@/lib/task-ui';

export type ProjectTaskRow = {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  workflow_status: WorkflowStatus;
  due_date: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  release_id: string | null;
  completion_note: string | null;
};

// The project's work. The same task model, controls and panel as a product's,
// scoped to the project rather than to a product or a release.
export default function ProjectTasks({
  projectId,
  tasks,
  canEdit,
  members,
  locale
}: {
  projectId: string;
  tasks: ProjectTaskRow[];
  canEdit: boolean;
  members: {userId: string; displayName: string}[];
  locale: string;
}) {
  const t = useTranslations('projects');
  const tTasks = useTranslations('tasks');
  const today = businessDate();
  const [items, override] = useTaskOverrides(tasks);
  const actions = useTaskActions({onOverride: override});
  const open = items.filter((task) => task.status === 'pending');
  const done = items.filter((task) => task.status === 'completed');

  return (
    <section className="space-y-3">
      {actions.dialog}
      {items.length === 0 ? <p className="text-xs text-faint">{t('tasks.empty')}</p> : null}
      {items.length > 0 ? (
        <ul className="divide-y divide-hairline rounded-md border border-hairline">
          {[...open, ...done].map((task) => {
            const completed = task.status === 'completed';
            return (
              <li key={task.id} className="flex items-center gap-2.5 px-3 py-2 text-xs">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => actions.toggle(task)}
                  aria-label={completed ? tTasks('task.reopen') : tTasks('task.complete')}
                  className={`shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                    completed ? 'text-accent' : 'text-faint hover:text-accent'
                  }`}
                >
                  {completed ? (
                    <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                  ) : (
                    <Circle className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => actions.open(task.id)}
                  className={`min-w-0 flex-1 truncate text-start text-sm hover:text-accent ${
                    completed ? 'text-faint line-through' : 'text-ink'
                  }`}
                >
                  {task.title}
                </button>
                <span className="hidden sm:inline">
                  <DueLabel dueDate={task.due_date} today={today} locale={locale} completed={completed} showIcon={false} />
                </span>
                <Avatar name={task.assignee_name} size="xs" />
                <StatusMenu
                  status={workflowOf(task)}
                  overdue={!completed && Boolean(task.due_date && task.due_date < today)}
                  onChange={
                    canEdit
                      ? (next) => {
                          if (next === 'done') actions.complete(task);
                          else void actions.setStatus(task, next);
                        }
                      : undefined
                  }
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {canEdit ? (
        <TaskQuickAdd compact members={members} projectId={projectId} placeholder={t('tasks.placeholder')} />
      ) : null}
    </section>
  );
}
