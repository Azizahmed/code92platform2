'use client';

import Image from 'next/image';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ImagePlus,
  ListTodo,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X
} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useMemo, useRef, useState, useTransition} from 'react';

import {
  addTaskAttachmentsAction,
  type StoredImage
} from '@/lib/actions/media';
import {
  createTaskAction,
  deleteTaskAction,
  type ProductTask,
  type TaskStatus,
  updateTaskAction
} from '@/lib/actions/tasks';
import {
  removeStoredImages,
  uploadImages,
  validateImageFiles
} from '@/lib/media-upload';
import {useRouter} from '@/i18n/navigation';

export type TaskMemberOption = {
  userId: string;
  displayName: string;
};

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

function errorKey(error: unknown): string {
  if (!(error instanceof Error)) return 'generic';
  return [
    'imageType',
    'imageSize',
    'tooManyImages',
    'uploadFailed'
  ].includes(error.message)
    ? error.message
    : 'generic';
}

function TaskEditor({
  productId,
  parentTaskId,
  task,
  members,
  onDone,
  onError
}: {
  productId: string;
  parentTaskId: string | null;
  task?: ProductTask;
  members: TaskMemberOption[];
  onDone: () => void;
  onError: (key: string) => void;
}) {
  const t = useTranslations('tasks');
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [dueDate, setDueDate] = useState(task?.due_date ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();

  function handleFiles(nextFiles: File[]) {
    const invalid = validateImageFiles(nextFiles);
    if (invalid) {
      onError(invalid);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setFiles(nextFiles);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError('');
    startTransition(async () => {
      const result = task
        ? await updateTaskAction(task.id, {
            title,
            notes: notes.trim() || null,
            dueDate: dueDate || null,
            assigneeId: assigneeId || null,
            status: task.status
          })
        : await createTaskAction({
            productId,
            parentTaskId,
            title,
            notes: notes.trim() || null,
            dueDate: dueDate || null,
            assigneeId: assigneeId || null
          });

      if (!result.ok) {
        onError(result.error);
        return;
      }

      if (!task && files.length > 0) {
        let uploaded: StoredImage[] = [];
        try {
          uploaded = await uploadImages(
            files,
            `products/${productId}/tasks/${result.taskId}`
          );
          const attachmentResult = await addTaskAttachmentsAction(
            result.taskId,
            uploaded
          );
          if (!attachmentResult.ok) {
            await removeStoredImages(uploaded.map((image) => image.key));
            onError(attachmentResult.error);
          }
        } catch (error) {
          onError(errorKey(error));
        }
      }

      onDone();
      router.refresh();
    });
  }

  const heading = task
    ? t('form.editTitle')
    : parentTaskId
      ? t('form.subtaskTitle')
      : t('form.newTitle');

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-accent/20 bg-accent/[0.035] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{heading}</h3>
        <button
          type="button"
          onClick={onDone}
          className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
          aria-label={t('form.cancel')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t('form.title')}</span>
        <input
          autoFocus
          required
          maxLength={240}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('form.titlePlaceholder')}
          className={INPUT_CLASS}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t('form.notes')}</span>
        <textarea
          rows={3}
          maxLength={5000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t('form.notesPlaceholder')}
          className={`${INPUT_CLASS} resize-y`}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.dueDate')}</span>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.assignee')}</span>
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">{t('form.unassigned')}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!task ? (
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.images')}</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) =>
              handleFiles(Array.from(event.target.files ?? []))
            }
            className="block w-full text-xs text-muted file:me-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-2 file:text-xs file:font-medium file:text-ink hover:file:bg-hairline"
          />
          <span className="text-[11px] text-faint">
            {files.length > 0
              ? t('media.selected', {count: files.length})
              : t('form.imagesHint')}
          </span>
        </label>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {task
            ? pending
              ? t('form.saving')
              : t('form.save')
            : pending
              ? t('form.creating')
              : t('form.create')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-hairline px-3.5 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          {t('form.cancel')}
        </button>
      </div>
    </form>
  );
}

function TaskCard({
  task,
  subtasks,
  productId,
  members,
  locale,
  editingTaskId,
  addingUnderId,
  uploadingTaskId,
  onEdit,
  onAddSubtask,
  onCloseEditor,
  onError,
  onToggle,
  onDelete,
  onAddImages
}: {
  task: ProductTask;
  subtasks: ProductTask[];
  productId: string;
  members: TaskMemberOption[];
  locale: string;
  editingTaskId: string | null;
  addingUnderId: string | null;
  uploadingTaskId: string | null;
  onEdit: (taskId: string) => void;
  onAddSubtask: (taskId: string) => void;
  onCloseEditor: () => void;
  onError: (key: string) => void;
  onToggle: (task: ProductTask) => void;
  onDelete: (task: ProductTask) => void;
  onAddImages: (task: ProductTask, files: File[]) => void;
}) {
  const t = useTranslations('tasks');
  const memberName = members.find(
    (member) => member.userId === task.assignee_id
  )?.displayName;
  const isCompleted = task.status === 'completed';
  const isOverdue =
    !isCompleted &&
    task.due_date !== null &&
    new Date(`${task.due_date}T23:59:59`).getTime() < Date.now();
  const date = task.due_date
    ? new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(new Date(`${task.due_date}T00:00:00`))
    : null;

  if (editingTaskId === task.id) {
    return (
      <TaskEditor
        productId={productId}
        parentTaskId={task.parent_task_id}
        task={task}
        members={members}
        onDone={onCloseEditor}
        onError={onError}
      />
    );
  }

  return (
    <article
      id={`task-${task.id}`}
      className={`group rounded-lg border bg-panel transition-colors ${
        isCompleted
          ? 'border-hairline opacity-65'
          : isOverdue
            ? 'border-amber/25'
            : 'border-hairline hover:border-accent/20'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => onToggle(task)}
            className={`mt-0.5 shrink-0 rounded-full transition-colors ${
              isCompleted
                ? 'text-accent'
                : 'text-faint hover:text-accent'
            }`}
            aria-label={
              isCompleted ? t('task.reopen') : t('task.complete')
            }
          >
            {isCompleted ? (
              <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
            ) : (
              <Circle className="h-5 w-5" strokeWidth={1.75} />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h3
                className={`text-sm font-medium leading-5 ${
                  isCompleted ? 'line-through text-muted' : 'text-ink'
                }`}
              >
                {task.title}
              </h3>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {!task.parent_task_id ? (
                  <button
                    type="button"
                    onClick={() => onAddSubtask(task.id)}
                    className="rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
                    aria-label={t('task.addSubtask')}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <label
                  className="cursor-pointer rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
                  aria-label={t('task.addImages')}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    disabled={uploadingTaskId === task.id}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = '';
                      if (files.length) onAddImages(task, files);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onEdit(task.id)}
                  className="rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
                  aria-label={t('task.edit')}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(task)}
                  className="rounded p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                  aria-label={t('task.delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {task.notes ? (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {task.notes}
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-faint">
              {date ? (
                <span
                  className={`inline-flex items-center gap-1 ${
                    isOverdue ? 'text-amber' : ''
                  }`}
                >
                  <CalendarDays className="h-3 w-3" />
                  {t('task.due', {date})}
                  {isOverdue ? (
                    <span className="rounded border border-amber/30 bg-amber/10 px-1 py-0.5 text-[9px] uppercase tracking-wider">
                      {t('task.overdue')}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <UserRound className="h-3 w-3" />
                {memberName
                  ? t('task.assignedTo', {name: memberName})
                  : t('task.unassigned')}
              </span>
              {subtasks.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <ChevronDown className="h-3 w-3" />
                  {t('task.subtasks', {count: subtasks.length})}
                </span>
              ) : null}
              {uploadingTaskId === task.id ? (
                <span className="text-accent">{t('task.uploading')}</span>
              ) : null}
            </div>

            {task.attachments.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {task.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.storage_url}
                    target="_blank"
                    rel="noreferrer"
                    className="relative h-16 w-20 overflow-hidden rounded-md border border-hairline bg-bg transition-colors hover:border-accent/40"
                    title={attachment.file_name}
                  >
                    <Image
                      src={attachment.storage_url}
                      alt={t('media.attachmentAlt', {
                        name: attachment.file_name
                      })}
                      fill
                      unoptimized
                      sizes="80px"
                      className="object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {subtasks.length > 0 || addingUnderId === task.id ? (
        <div className="space-y-2 border-t border-hairline bg-bg/25 p-3 ps-11">
          {subtasks.map((subtask) => (
            <TaskCard
              key={subtask.id}
              task={subtask}
              subtasks={[]}
              productId={productId}
              members={members}
              locale={locale}
              editingTaskId={editingTaskId}
              addingUnderId={addingUnderId}
              uploadingTaskId={uploadingTaskId}
              onEdit={onEdit}
              onAddSubtask={onAddSubtask}
              onCloseEditor={onCloseEditor}
              onError={onError}
              onToggle={onToggle}
              onDelete={onDelete}
              onAddImages={onAddImages}
            />
          ))}
          {addingUnderId === task.id ? (
            <TaskEditor
              productId={productId}
              parentTaskId={task.id}
              members={members}
              onDone={onCloseEditor}
              onError={onError}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function ProductTasksPanel({
  productId,
  tasks,
  members,
  locale,
  disabled = false
}: {
  productId: string;
  tasks: ProductTask[];
  members: TaskMemberOption[];
  locale: string;
  disabled?: boolean;
}) {
  const t = useTranslations('tasks');
  const router = useRouter();
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [addingUnderId, setAddingUnderId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const roots = useMemo(
    () => tasks.filter((task) => task.parent_task_id === null),
    [tasks]
  );
  const children = useMemo(() => {
    const map = new Map<string, ProductTask[]>();
    for (const task of tasks) {
      if (!task.parent_task_id) continue;
      const list = map.get(task.parent_task_id) ?? [];
      list.push(task);
      map.set(task.parent_task_id, list);
    }
    return map;
  }, [tasks]);
  const openCount = tasks.filter((task) => task.status === 'pending').length;
  const completedCount = tasks.length - openCount;

  function closeEditors() {
    setCreatingRoot(false);
    setAddingUnderId(null);
    setEditingTaskId(null);
  }

  function toggle(task: ProductTask) {
    setError(null);
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
      router.refresh();
    });
  }

  function removeTask(task: ProductTask) {
    if (!window.confirm(t('task.deleteConfirm'))) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteTaskAction(task.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.storageKeys?.length) {
        await removeStoredImages(result.storageKeys);
      }
      router.refresh();
    });
  }

  async function addImages(task: ProductTask, files: File[]) {
    const invalid = validateImageFiles(files);
    if (invalid) {
      setError(invalid);
      return;
    }

    setError(null);
    setUploadingTaskId(task.id);
    let uploaded: StoredImage[] = [];
    try {
      uploaded = await uploadImages(
        files,
        `products/${productId}/tasks/${task.id}`
      );
      const result = await addTaskAttachmentsAction(task.id, uploaded);
      if (!result.ok) {
        await removeStoredImages(uploaded.map((image) => image.key));
        setError(result.error);
        return;
      }
      router.refresh();
    } catch (uploadError) {
      setError(errorKey(uploadError));
    } finally {
      setUploadingTaskId(null);
    }
  }

  return (
    <section id="tasks" className="scroll-mt-8 space-y-4">
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
        {!disabled ? (
          <button
            type="button"
            onClick={() => {
              closeEditors();
              setCreatingRoot(true);
              setError(null);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t('section.newTask')}
          </button>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {creatingRoot ? (
        <TaskEditor
          productId={productId}
          parentTaskId={null}
          members={members}
          onDone={closeEditors}
          onError={(key) => setError(key || null)}
        />
      ) : null}

      {roots.length === 0 && !creatingRoot ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
            <Check className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h3 className="mt-3 text-sm font-medium">{t('section.emptyTitle')}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">
            {t('section.emptyBody')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {roots.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              subtasks={children.get(task.id) ?? []}
              productId={productId}
              members={members}
              locale={locale}
              editingTaskId={editingTaskId}
              addingUnderId={addingUnderId}
              uploadingTaskId={uploadingTaskId}
              onEdit={(taskId) => {
                closeEditors();
                setEditingTaskId(taskId);
                setError(null);
              }}
              onAddSubtask={(taskId) => {
                closeEditors();
                setAddingUnderId(taskId);
                setError(null);
              }}
              onCloseEditor={closeEditors}
              onError={(key) => setError(key || null)}
              onToggle={toggle}
              onDelete={removeTask}
              onAddImages={addImages}
            />
          ))}
        </div>
      )}
    </section>
  );
}
