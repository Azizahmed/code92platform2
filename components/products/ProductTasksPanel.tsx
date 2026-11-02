'use client';

import {
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  ListTodo,
  ListTree,
  Paperclip,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useMemo, useRef, useState} from 'react';

import DueLabel from '@/components/tasks/DueLabel';
import StatusMenu from '@/components/tasks/StatusMenu';
import TaskAttachments from '@/components/tasks/TaskAttachments';
import TaskCompletionNote from '@/components/tasks/TaskCompletionNote';
import TaskEditorModal from '@/components/tasks/TaskEditorModal';
import type {TaskEditorDefaults} from '@/components/tasks/TaskEditorDialog';
import TaskQuickAdd from '@/components/tasks/TaskQuickAdd';
import {useTaskActions, useTaskOverrides} from '@/components/tasks/useTaskActions';
import Avatar from '@/components/ui/Avatar';
import Menu from '@/components/ui/Menu';
import {useToast} from '@/components/ui/ToastProvider';
import {useRouter} from '@/i18n/navigation';
import {addTaskAttachmentsAction, type StoredImage} from '@/lib/actions/media';
import {setTaskWatchAction} from '@/lib/actions/notifications';
import type {ProductTask} from '@/lib/actions/tasks';
import {DOCUMENT_ACCEPT} from '@/lib/attachments';
import {businessDate} from '@/lib/dates';
import {removeStoredImages, uploadAttachments, validateAttachmentFiles} from '@/lib/media-upload';
import {workflowOf} from '@/lib/task-ui';

export type TaskMemberOption = {
  userId: string;
  displayName: string;
};

type Actions = ReturnType<typeof useTaskActions>;

function TaskCard({
  task,
  subtasks,
  productId,
  members,
  locale,
  today,
  disabled,
  addingUnder,
  actions,
  onEdit,
  onAddSubtask,
  onCloseSubtask
}: {
  task: ProductTask;
  subtasks: ProductTask[];
  productId: string;
  members: TaskMemberOption[];
  locale: string;
  today: string;
  disabled: boolean;
  addingUnder: string | null;
  actions: Actions;
  onEdit: (task: ProductTask) => void;
  onAddSubtask: (taskId: string) => void;
  onCloseSubtask: () => void;
}) {
  const t = useTranslations('tasks');
  const toast = useToast();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const memberName = (id: string | null) =>
    id ? members.find((member) => member.userId === id)?.displayName ?? null : null;
  const completed = task.status === 'completed';
  const status = workflowOf(task);
  const overdue = !completed && Boolean(task.due_date && task.due_date < today);
  const isSubtask = Boolean(task.parent_task_id);
  const doneSubtasks = subtasks.filter((subtask) => subtask.status === 'completed').length;

  async function addFiles(files: File[]) {
    const invalid = validateAttachmentFiles(files);
    if (invalid) {
      toast({message: t(`errors.${invalid}`), tone: 'error'});
      return;
    }
    setUploading(true);
    let uploaded: StoredImage[] = [];
    try {
      uploaded = await uploadAttachments(files, `products/${productId}/tasks/${task.id}`);
      const result = await addTaskAttachmentsAction(task.id, uploaded);
      if (!result.ok) {
        await removeStoredImages(uploaded.map((image) => image.key));
        toast({message: t(`errors.${result.error}`), tone: 'error'});
        return;
      }
      toast({message: t('feedback.filesAdded', {count: uploaded.length})});
      setTimeout(() => router.refresh(), 0);
    } catch {
      toast({message: t('errors.uploadFailed'), tone: 'error'});
    } finally {
      setUploading(false);
    }
  }

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
    <article
      id={`task-${task.id}`}
      className={`rounded-lg border bg-panel transition-colors ${
        completed ? 'border-hairline opacity-70' : overdue ? 'border-amber/25' : 'border-hairline hover:border-accent/20'
      } ${isSubtask ? 'bg-bg/40' : ''}`}
    >
      <div className={isSubtask ? 'p-3' : 'p-4'}>
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => actions.toggle(task)}
            disabled={disabled}
            className={`mt-0.5 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              completed ? 'text-accent' : 'text-faint hover:text-accent'
            }`}
            aria-label={completed ? t('task.reopen') : t('task.complete')}
          >
            {completed ? (
              <CheckCircle2 className={isSubtask ? 'h-4 w-4' : 'h-5 w-5'} strokeWidth={1.75} />
            ) : (
              <Circle className={isSubtask ? 'h-4 w-4' : 'h-5 w-5'} strokeWidth={1.75} />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => actions.open(task.id)}
                className={`text-start text-sm font-medium leading-5 transition-colors hover:text-accent ${
                  completed ? 'text-muted line-through' : 'text-ink'
                }`}
              >
                {task.title}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <StatusMenu
                  status={status}
                  overdue={overdue}
                  onChange={
                    disabled
                      ? undefined
                      : (next) => {
                          if (next === 'done') actions.complete(task);
                          else void actions.setStatus(task, next);
                        }
                  }
                />
                {!disabled ? (
                  <Menu
                    label={t('task.actions')}
                    items={[
                      {key: 'open', label: t('task.open'), icon: ExternalLink, onSelect: () => actions.open(task.id)},
                      {key: 'edit', label: t('task.edit'), icon: Pencil, onSelect: () => onEdit(task)},
                      ...(!isSubtask
                        ? [{key: 'sub', label: t('task.addSubtask'), icon: Plus, onSelect: () => onAddSubtask(task.id)}]
                        : []),
                      {
                        key: 'files',
                        label: uploading ? t('task.uploading') : t('task.addFiles'),
                        icon: Paperclip,
                        disabled: uploading,
                        onSelect: () => fileInput.current?.click()
                      },
                      {
                        key: 'watch',
                        label: task.is_watching ? t('task.unwatch') : t('task.watch'),
                        icon: task.is_watching ? BellOff : Bell,
                        onSelect: () => void toggleWatch()
                      },
                      {key: 'delete', label: t('task.delete'), icon: Trash2, tone: 'danger', onSelect: () => void actions.remove(task)}
                    ]}
                  />
                ) : null}
                <input
                  ref={fileInput}
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    if (files.length) void addFiles(files);
                  }}
                />
              </div>
            </div>

            {task.notes ? (
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">{task.notes}</p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-faint">
              <DueLabel dueDate={task.due_date} today={today} locale={locale} completed={completed} />
              <span className="inline-flex items-center gap-1.5">
                <Avatar name={memberName(task.assignee_id)} size="xs" />
                {memberName(task.assignee_id) ?? t('task.unassigned')}
              </span>
              {subtasks.length > 0 ? (
                <span
                  className={`inline-flex items-center gap-1 ${doneSubtasks === subtasks.length ? 'text-accent' : ''}`}
                >
                  <ListTree className="h-3 w-3" strokeWidth={1.75} />
                  <span className="font-mono">
                    {doneSubtasks}/{subtasks.length}
                  </span>
                </span>
              ) : null}
              {uploading ? <span className="text-accent">{t('task.uploading')}</span> : null}
            </div>

            {completed ? (
              <TaskCompletionNote
                note={task.completion_note}
                completedBy={memberName(task.completed_by)}
                completedAt={task.completed_at}
              />
            ) : null}

            {task.attachments.length > 0 ? (
              <div className="mt-3">
                <TaskAttachments attachments={task.attachments} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {subtasks.length > 0 || addingUnder === task.id ? (
        <div className="space-y-2 border-t border-hairline bg-bg/25 p-3 ps-11">
          {subtasks.map((subtask) => (
            <TaskCard
              key={subtask.id}
              task={subtask}
              subtasks={[]}
              productId={productId}
              members={members}
              locale={locale}
              today={today}
              disabled={disabled}
              addingUnder={addingUnder}
              actions={actions}
              onEdit={onEdit}
              onAddSubtask={onAddSubtask}
              onCloseSubtask={onCloseSubtask}
            />
          ))}
          {addingUnder === task.id ? (
            <div className="space-y-1">
              <TaskQuickAdd
                compact
                autoFocus
                members={members}
                productId={productId}
                parentTaskId={task.id}
                placeholder={t('drawer.addSubtask')}
              />
              <button type="button" onClick={onCloseSubtask} className="text-xs text-faint hover:text-ink">
                {t('form.cancel')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function ProductTasksPanel({
  productId,
  productName,
  tasks,
  members,
  locale,
  disabled = false
}: {
  productId: string;
  productName: string;
  tasks: ProductTask[];
  members: TaskMemberOption[];
  locale: string;
  disabled?: boolean;
}) {
  const t = useTranslations('tasks');
  const today = businessDate();
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    {kind: 'new'; defaults: TaskEditorDefaults} | {kind: 'edit'; task: ProductTask} | null
  >(null);
  const [items, override] = useTaskOverrides(tasks);
  const actions = useTaskActions({onOverride: override});
  const productOptions = useMemo(() => [{id: productId, name: productName}], [productId, productName]);

  const roots = useMemo(() => items.filter((task) => task.parent_task_id === null), [items]);
  const children = useMemo(() => {
    const map = new Map<string, ProductTask[]>();
    for (const task of items) {
      if (!task.parent_task_id) continue;
      const list = map.get(task.parent_task_id) ?? [];
      list.push(task);
      map.set(task.parent_task_id, list);
    }
    return map;
  }, [items]);
  // Open work first; finished work stays below, out of the way.
  const ordered = useMemo(
    () => [...roots.filter((task) => task.status === 'pending'), ...roots.filter((task) => task.status === 'completed')],
    [roots]
  );
  const openCount = items.filter((task) => task.status === 'pending').length;
  const completedCount = items.length - openCount;

  return (
    <section id="tasks" className="scroll-mt-8 space-y-4">
      {actions.dialog}
      {editor ? (
        <TaskEditorModal
          task={editor.kind === 'edit' ? editor.task : undefined}
          defaults={editor.kind === 'new' ? editor.defaults : undefined}
          lockProduct
          products={productOptions}
          members={members}
          onClose={(createdId) => {
            setEditor(null);
            if (createdId) actions.open(createdId);
          }}
          onError={() => {}}
        />
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-accent" strokeWidth={1.75} />
            <h2 className="text-sm font-medium">{t('section.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted">{t('section.subtitle')}</p>
          <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-faint">
            <span>{t('section.open', {count: openCount})}</span>
            <span aria-hidden="true">/</span>
            <span>{t('section.completed', {count: completedCount})}</span>
          </div>
        </div>
      </header>

      {!disabled ? (
        <TaskQuickAdd
          members={members}
          productId={productId}
          onMoreOptions={(draft) => setEditor({kind: 'new', defaults: {...draft, productId}})}
        />
      ) : null}

      {roots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
            <Check className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h3 className="mt-3 text-sm font-medium">{t('section.emptyTitle')}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">{t('section.emptyBody')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              subtasks={children.get(task.id) ?? []}
              productId={productId}
              members={members}
              locale={locale}
              today={today}
              disabled={disabled}
              addingUnder={addingUnder}
              actions={actions}
              onEdit={(target) => setEditor({kind: 'edit', task: target})}
              onAddSubtask={(taskId) => setAddingUnder(taskId)}
              onCloseSubtask={() => setAddingUnder(null)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
