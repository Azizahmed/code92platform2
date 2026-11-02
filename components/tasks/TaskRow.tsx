'use client';

import Image from 'next/image';
import {
  Bell,
  BellOff,
  CheckCircle2,
  Circle,
  CornerDownRight,
  ExternalLink,
  ListTree,
  Paperclip,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react';
import {useTranslations} from 'next-intl';
import type {ReactNode} from 'react';

import DueLabel from '@/components/tasks/DueLabel';
import StatusMenu from '@/components/tasks/StatusMenu';
import type {useTaskActions} from '@/components/tasks/useTaskActions';
import Avatar from '@/components/ui/Avatar';
import Menu from '@/components/ui/Menu';
import {useToast} from '@/components/ui/ToastProvider';
import {useRouter} from '@/i18n/navigation';
import {setTaskWatchAction} from '@/lib/actions/notifications';
import type {ProductTask} from '@/lib/actions/tasks';
import {workflowOf} from '@/lib/task-ui';

export type SubtaskProgress = {done: number; total: number};

export type RowTask = ProductTask & {
  product_name?: string | null;
  product_logo_url?: string | null;
  assignee_name?: string | null;
  parent_title?: string | null;
};

// One task in a list. The whole title opens the task panel; the circle
// completes it; the chip changes its status; everything else is in "⋯".
export default function TaskRow({
  task,
  depth = 0,
  today,
  locale,
  progress,
  showAssignee = true,
  showProduct = true,
  showParent = true,
  actions,
  onEdit,
  onAddSubtask,
  children
}: {
  task: RowTask;
  depth?: 0 | 1;
  today: string;
  locale: string;
  progress?: SubtaskProgress;
  showAssignee?: boolean;
  showProduct?: boolean;
  showParent?: boolean;
  actions: ReturnType<typeof useTaskActions>;
  onEdit?: () => void;
  onAddSubtask?: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations('tasks');
  const toast = useToast();
  const router = useRouter();
  const completed = task.status === 'completed';
  const status = workflowOf(task);
  const overdue = !completed && Boolean(task.due_date && task.due_date < today);

  async function toggleWatch() {
    const result = await setTaskWatchAction(task.id, !task.is_watching);
    if (!result.ok) {
      toast({message: t('errors.generic'), tone: 'error'});
      return;
    }
    toast({message: task.is_watching ? t('feedback.unwatched') : t('feedback.watching'), tone: 'info'});
    setTimeout(() => router.refresh(), 0);
  }

  return (
    <li className="border-b border-hairline last:border-0">
      <div
        className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 transition-colors hover:bg-raised/30 ${
          showAssignee ? 'lg:grid-cols-[auto_minmax(0,1fr)_170px_130px_auto]' : 'lg:grid-cols-[auto_minmax(0,1fr)_130px_auto]'
        } ${depth === 1 ? 'bg-bg/30 ps-11' : ''}`}
      >
        <button
          type="button"
          onClick={() => actions.toggle(task)}
          aria-label={completed ? t('task.reopen') : t('task.complete')}
          title={completed ? t('task.reopen') : t('task.complete')}
          className={`mt-px shrink-0 rounded-full transition-colors ${
            completed ? 'text-accent' : 'text-faint hover:text-accent'
          }`}
        >
          {completed ? (
            <CheckCircle2 className={depth ? 'h-4 w-4' : 'h-5 w-5'} strokeWidth={1.75} />
          ) : (
            <Circle className={depth ? 'h-4 w-4' : 'h-5 w-5'} strokeWidth={1.75} />
          )}
        </button>

        <div className="min-w-0">
          <button
            type="button"
            onClick={() => actions.open(task.id)}
            className={`block max-w-full truncate text-start text-sm font-medium transition-colors hover:text-accent ${
              completed ? 'text-muted line-through' : 'text-ink'
            }`}
          >
            {task.title}
          </button>

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-faint">
            {showProduct && depth === 0 ? (
              task.product_name ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded border border-hairline bg-raised font-mono text-[8px]">
                    {task.product_logo_url ? (
                      <Image src={task.product_logo_url} alt="" fill unoptimized sizes="16px" className="object-cover" />
                    ) : (
                      task.product_name.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  {task.product_name}
                </span>
              ) : task.project_id ? (
                <span className="rounded border border-accent/25 bg-accent/5 px-1.5 py-0.5 text-[10px] text-accent">
                  {t('all.projectTask')}
                </span>
              ) : (
                <span>{t('all.general')}</span>
              )
            ) : null}
            {showParent && task.parent_title && depth === 0 ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <CornerDownRight className="h-3 w-3 shrink-0 rtl:rotate-180" strokeWidth={1.75} />
                <span className="truncate">{task.parent_title}</span>
              </span>
            ) : null}
            {progress && progress.total > 0 ? (
              <span
                className={`inline-flex items-center gap-1 ${progress.done === progress.total ? 'text-accent' : ''}`}
                title={t('task.subtasks', {count: progress.total})}
              >
                <ListTree className="h-3 w-3" strokeWidth={1.75} />
                <span className="font-mono">
                  {progress.done}/{progress.total}
                </span>
              </span>
            ) : null}
            {task.attachments.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" strokeWidth={1.75} />
                {task.attachments.length}
              </span>
            ) : null}
            {/* On phones the date and owner columns are hidden; they ride the meta line. */}
            <span className="lg:hidden">
              <DueLabel dueDate={task.due_date} today={today} locale={locale} completed={completed} />
            </span>
            {showAssignee ? (
              <span className="inline-flex items-center gap-1 lg:hidden">
                <Avatar name={task.assignee_name} size="xs" />
                <span className="max-w-[8rem] truncate">{task.assignee_name ?? t('task.unassigned')}</span>
              </span>
            ) : null}
          </div>
        </div>

        {showAssignee ? (
          <div className="hidden min-w-0 items-center gap-2 pt-0.5 text-xs text-muted lg:flex">
            <Avatar name={task.assignee_name} />
            <span className="truncate">{task.assignee_name ?? t('task.unassigned')}</span>
          </div>
        ) : null}

        <div className="hidden pt-1 text-xs lg:block">
          <DueLabel dueDate={task.due_date} today={today} locale={locale} completed={completed} emptyLabel />
        </div>

        <div className="flex items-center gap-1">
          <StatusMenu
            status={status}
            overdue={overdue}
            onChange={(next) => {
              if (next === 'done') actions.complete(task);
              else void actions.setStatus(task, next);
            }}
          />
          <Menu
            label={t('task.actions')}
            items={[
              {key: 'open', label: t('task.open'), icon: ExternalLink, onSelect: () => actions.open(task.id)},
              ...(onEdit ? [{key: 'edit', label: t('task.edit'), icon: Pencil, onSelect: onEdit}] : []),
              ...(onAddSubtask ? [{key: 'sub', label: t('task.addSubtask'), icon: Plus, onSelect: onAddSubtask}] : []),
              {
                key: 'watch',
                label: task.is_watching ? t('task.unwatch') : t('task.watch'),
                icon: task.is_watching ? BellOff : Bell,
                onSelect: () => void toggleWatch()
              },
              {key: 'delete', label: t('task.delete'), icon: Trash2, tone: 'danger', onSelect: () => void actions.remove(task)}
            ]}
          />
        </div>
      </div>
      {children ? <ul className="border-t border-hairline">{children}</ul> : null}
    </li>
  );
}
