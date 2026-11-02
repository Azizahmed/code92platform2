'use client';

import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  CornerDownRight,
  FolderKanban,
  Link2,
  ListTodo,
  Package,
  Paperclip,
  Pencil,
  Rocket,
  Trash2,
  X
} from 'lucide-react';
import {useLocale, useTranslations} from 'next-intl';
import {useSearchParams} from 'next/navigation';
import {useCallback, useEffect, useRef, useState} from 'react';

import RelativeTime from '@/components/RelativeTime';
import DueLabel from '@/components/tasks/DueLabel';
import StatusMenu from '@/components/tasks/StatusMenu';
import TaskAttachments from '@/components/tasks/TaskAttachments';
import TaskEditorDialog from '@/components/tasks/TaskEditorDialog';
import TaskQuickAdd from '@/components/tasks/TaskQuickAdd';
import TaskWatchToggle from '@/components/tasks/TaskWatchToggle';
import {useTaskActions} from '@/components/tasks/useTaskActions';
import Avatar from '@/components/ui/Avatar';
import {useToast} from '@/components/ui/ToastProvider';
import {Link} from '@/i18n/navigation';
import {addTaskAttachmentsAction, type StoredImage} from '@/lib/actions/media';
import {getTaskDetailAction, type TaskDetailResult} from '@/lib/actions/tasks';
import {DOCUMENT_ACCEPT} from '@/lib/attachments';
import {businessDate} from '@/lib/dates';
import {removeStoredImages, uploadAttachments, validateAttachmentFiles} from '@/lib/media-upload';
import {closeTaskDrawer, openTaskDrawer, TASK_PARAM, taskLink} from '@/lib/task-drawer';
import {workflowOf} from '@/lib/task-ui';

type Loaded = Extract<TaskDetailResult, {ok: true}>;

function Field({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 py-1.5 text-sm">
      <span className="text-xs text-faint">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// The task, on its own: everything about it in one place, opened from any list,
// notification or shared link with ?task=<id>. Lives in the app shell so it can
// sit over whichever page opened it.
export default function TaskDrawer() {
  const searchParams = useSearchParams();
  const taskId = searchParams.get(TASK_PARAM);
  if (!taskId) return null;
  return <DrawerBody key={taskId} taskId={taskId} />;
}

function DrawerBody({taskId}: {taskId: string}) {
  const t = useTranslations('tasks');
  const locale = useLocale();
  const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const today = businessDate();

  const load = useCallback(async () => {
    const result = await getTaskDetailAction(taskId);
    if (result.ok) {
      setData(result);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useTaskActions({onChanged: () => void load()});

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Dialogs opened from the panel close themselves first.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (editing) setEditing(false);
      else closeTaskDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  async function addFiles(files: File[]) {
    if (!data) return;
    const invalid = validateAttachmentFiles(files);
    if (invalid) {
      toast({message: t(`errors.${invalid}`), tone: 'error'});
      return;
    }
    setUploading(true);
    let uploaded: StoredImage[] = [];
    try {
      const prefix = data.task.product_id
        ? `products/${data.task.product_id}/tasks/${data.task.id}`
        : `tasks/${data.task.id}`;
      uploaded = await uploadAttachments(files, prefix);
      const result = await addTaskAttachmentsAction(data.task.id, uploaded);
      if (!result.ok) {
        await removeStoredImages(uploaded.map((image) => image.key));
        toast({message: t(`errors.${result.error}`), tone: 'error'});
      } else {
        toast({message: t('feedback.filesAdded', {count: uploaded.length})});
        await load();
      }
    } catch {
      toast({message: t('errors.uploadFailed'), tone: 'error'});
    } finally {
      setUploading(false);
    }
  }

  async function copyLink() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(taskLink(data.task, locale));
      toast({message: t('feedback.linkCopied'), tone: 'info'});
    } catch {
      toast({message: t('errors.generic'), tone: 'error'});
    }
  }

  const task = data?.task;
  const status = task ? workflowOf(task) : 'todo';
  const completed = task?.status === 'completed';
  const subtasks = task?.subtasks ?? [];
  const subtasksDone = subtasks.filter((subtask) => subtask.status === 'completed').length;
  const overdue = Boolean(task && !completed && task.due_date && task.due_date < today);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label={t('drawer.close')}
        onClick={closeTaskDrawer}
        className="absolute inset-0 bg-bg/60 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label={task?.title ?? t('drawer.title')}
        className="drawer-enter relative flex h-full w-full flex-col border-s border-hairline bg-panel shadow-2xl outline-none sm:max-w-lg"
      >
        <header className="flex items-center gap-2 border-b border-hairline px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-faint">
            {task?.product_id ? (
              <Link
                href={`/products/${task.product_id}?tab=tasks`}
                className="inline-flex min-w-0 items-center gap-1.5 truncate hover:text-accent"
              >
                <Package className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{task.product_name ?? t('all.general')}</span>
              </Link>
            ) : task?.project_id ? (
              <Link
                href={`/projects/${task.project_id}`}
                className="inline-flex min-w-0 items-center gap-1.5 truncate hover:text-accent"
              >
                <FolderKanban className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{task.project_name ?? t('all.projectTask')}</span>
              </Link>
            ) : task ? (
              <Link href="/tasks?product=general" className="inline-flex items-center gap-1.5 hover:text-accent">
                <ListTodo className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('all.general')}
              </Link>
            ) : null}
          </div>
          {task ? (
            <>
              <TaskWatchToggle taskId={task.id} watching={task.is_watching} compact />
              <button
                type="button"
                onClick={() => void copyLink()}
                aria-label={t('drawer.copyLink')}
                title={t('drawer.copyLink')}
                className="rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
              >
                <Link2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={t('task.edit')}
                title={t('task.edit')}
                className="rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
              >
                <Pencil className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await actions.remove(task)) closeTaskDrawer();
                }}
                aria-label={t('task.delete')}
                title={t('task.delete')}
                className="rounded p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={closeTaskDrawer}
            aria-label={t('drawer.close')}
            className="ms-1 rounded-md border border-hairline p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {error ? (
            <div className="rounded-lg border border-dashed border-hairline px-4 py-10 text-center">
              <p className="text-sm text-muted">{t(`errors.${error}`)}</p>
            </div>
          ) : !data || !task ? (
            <div className="space-y-3" aria-busy="true">
              <div className="h-6 w-3/4 animate-pulse rounded bg-raised" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-raised" />
              <div className="h-24 animate-pulse rounded bg-raised" />
            </div>
          ) : editing ? (
            <TaskEditorDialog
              task={task}
              products={data.products}
              members={data.members}
              bare
              onDone={() => {
                setEditing(false);
                void load();
                toast({message: t('feedback.saved')});
              }}
              onError={(key) => {
                if (key) toast({message: t(`errors.${key}`), tone: 'error'});
              }}
            />
          ) : (
            <div className="space-y-6">
              <section className="space-y-3">
                {task.parent ? (
                  <button
                    type="button"
                    onClick={() => openTaskDrawer(task.parent!.id)}
                    className="inline-flex max-w-full items-center gap-1.5 text-xs text-faint hover:text-accent"
                  >
                    <CornerDownRight className="h-3.5 w-3.5 shrink-0 rtl:rotate-180" strokeWidth={1.75} />
                    <span className="truncate">{task.parent.title}</span>
                  </button>
                ) : null}
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => actions.toggle(task)}
                    aria-label={completed ? t('task.reopen') : t('task.complete')}
                    className={`mt-0.5 shrink-0 rounded-full transition-colors ${
                      completed ? 'text-accent' : 'text-faint hover:text-accent'
                    }`}
                  >
                    {completed ? (
                      <CheckCircle2 className="h-6 w-6" strokeWidth={1.75} />
                    ) : (
                      <Circle className="h-6 w-6" strokeWidth={1.75} />
                    )}
                  </button>
                  <h2
                    className={`text-lg font-semibold leading-snug ${
                      completed ? 'text-muted line-through' : 'text-ink'
                    }`}
                  >
                    {task.title}
                  </h2>
                </div>
              </section>

              <section className="divide-y divide-hairline rounded-lg border border-hairline bg-bg/40 px-3">
                <Field label={t('drawer.status')}>
                  <StatusMenu
                    status={status}
                    overdue={overdue}
                    size="md"
                    onChange={(next) => {
                      if (next === 'done') actions.complete(task);
                      else void actions.setStatus(task, next);
                    }}
                  />
                </Field>
                <Field label={t('form.assignee')}>
                  <span className="inline-flex items-center gap-2 text-ink">
                    <Avatar name={task.assignee_name} />
                    <span className="truncate">{task.assignee_name ?? t('task.unassigned')}</span>
                  </span>
                </Field>
                <Field label={t('form.dueDate')}>
                  <DueLabel
                    dueDate={task.due_date}
                    today={today}
                    locale={locale}
                    completed={completed}
                    emptyLabel
                    className="text-sm"
                  />
                </Field>
                {task.release_id ? (
                  <Field label={t('drawer.release')}>
                    <Link
                      href={`/releases/${task.release_id}`}
                      className="inline-flex items-center gap-1.5 text-ink hover:text-accent"
                    >
                      <Rocket className="h-3.5 w-3.5 text-faint" strokeWidth={1.75} />
                      {task.release_name ?? t('drawer.release')}
                    </Link>
                  </Field>
                ) : null}
                <Field label={t('drawer.created')}>
                  <span className="text-xs text-muted">
                    {task.created_by_name ? `${task.created_by_name} · ` : ''}
                    <RelativeTime date={task.created_at} />
                  </span>
                </Field>
              </section>

              <section className="space-y-2">
                <h3 className="text-[11px] font-medium uppercase tracking-widest text-faint">{t('form.notes')}</h3>
                {task.notes ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{task.notes}</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="text-sm text-faint hover:text-accent"
                  >
                    {t('drawer.addNotes')}
                  </button>
                )}
              </section>

              {completed ? (
                <section className="space-y-2 rounded-lg border border-accent/20 bg-accent/[0.04] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
                      <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {t('completion.noteTitle')}
                    </h3>
                    <button
                      type="button"
                      onClick={() => actions.addNote(task)}
                      className="text-xs text-muted hover:text-accent"
                    >
                      {task.completion_note ? t('drawer.editNote') : t('feedback.addNote')}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
                    {task.completion_note || t('drawer.noCompletionNote')}
                  </p>
                  {task.completed_at ? (
                    <p className="text-[11px] text-faint">
                      {task.completed_by_name ? `${task.completed_by_name} · ` : ''}
                      <RelativeTime date={task.completed_at} />
                    </p>
                  ) : null}
                </section>
              ) : null}

              {!task.parent_task_id ? (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-medium uppercase tracking-widest text-faint">
                      {t('drawer.subtasks')}
                    </h3>
                    {subtasks.length > 0 ? (
                      <span className="font-mono text-[11px] text-faint">
                        {subtasksDone}/{subtasks.length}
                      </span>
                    ) : null}
                  </div>
                  {subtasks.length > 0 ? (
                    <>
                      <div className="h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{width: `${(subtasksDone / subtasks.length) * 100}%`}}
                        />
                      </div>
                      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
                        {subtasks.map((subtask) => {
                          const done = subtask.status === 'completed';
                          return (
                            <li key={subtask.id} className="flex items-center gap-2.5 px-3 py-2">
                              <button
                                type="button"
                                onClick={() => actions.toggle({...subtask, title: subtask.title})}
                                aria-label={done ? t('task.reopen') : t('task.complete')}
                                className={`shrink-0 rounded-full ${done ? 'text-accent' : 'text-faint hover:text-accent'}`}
                              >
                                {done ? (
                                  <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                                ) : (
                                  <Circle className="h-4 w-4" strokeWidth={1.75} />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => openTaskDrawer(subtask.id)}
                                className={`min-w-0 flex-1 truncate text-start text-sm hover:text-accent ${
                                  done ? 'text-muted line-through' : 'text-ink'
                                }`}
                              >
                                {subtask.title}
                              </button>
                              <DueLabel
                                dueDate={subtask.due_date}
                                today={today}
                                locale={locale}
                                completed={done}
                                showIcon={false}
                                className="text-[11px]"
                              />
                              <Avatar name={subtask.assignee_name} size="xs" />
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : null}
                  {!task.project_id ? (
                    <TaskQuickAdd
                      compact
                      members={data.members}
                      productId={task.product_id}
                      parentTaskId={task.id}
                      placeholder={t('drawer.addSubtask')}
                      onCreated={() => void load()}
                    />
                  ) : null}
                </section>
              ) : null}

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-medium uppercase tracking-widest text-faint">
                    {t('form.attachments')}
                  </h3>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
                    <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {uploading ? t('task.uploading') : t('task.addFiles')}
                    <input
                      type="file"
                      accept={DOCUMENT_ACCEPT}
                      multiple
                      className="sr-only"
                      disabled={uploading}
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.target.value = '';
                        if (files.length) void addFiles(files);
                      }}
                    />
                  </label>
                </div>
                {task.attachments.length > 0 ? (
                  <TaskAttachments attachments={task.attachments} />
                ) : (
                  <p className="text-xs text-faint">{t('drawer.noFiles')}</p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
      {actions.dialog}
    </div>
  );
}
