'use client';

import {X} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useRef, useState, useTransition} from 'react';

import type {TaskMemberOption} from '@/components/products/ProductTasksPanel';
import type {TaskProductOption} from '@/components/tasks/AllTasksBoard';
import {
  addTaskAttachmentsAction,
  type StoredImage
} from '@/lib/actions/media';
import {drainNotificationEmailsAction} from '@/lib/actions/notifications';
import {
  createTaskAction,
  type ProductTask,
  updateTaskAction
} from '@/lib/actions/tasks';
import {DOCUMENT_ACCEPT} from '@/lib/attachments';
import {LIFECYCLE_PHASES, type LifecyclePhase} from '@/lib/lifecycle';
import {
  removeStoredImages,
  uploadAttachments,
  validateAttachmentFiles
} from '@/lib/media-upload';

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

// The value the product <select> uses for "no product". An empty string, not a
// sentinel word, so it reads as unset and cannot collide with a product id.
const GENERAL = '';

function errorKey(error: unknown): string {
  if (!(error instanceof Error)) return 'generic';
  return [
    'imageType',
    'imageSize',
    'tooManyImages',
    'fileType',
    'fileSize',
    'tooManyFiles',
    'uploadFailed'
  ].includes(error.message)
    ? error.message
    : 'generic';
}

export default function TaskEditorDialog({
  task,
  products,
  members,
  onDone,
  onError
}: {
  // Absent when creating.
  task?: ProductTask;
  products: TaskProductOption[];
  members: TaskMemberOption[];
  onDone: () => void;
  onError: (key: string) => void;
}) {
  const t = useTranslations('tasks');
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [dueDate, setDueDate] = useState(task?.due_date ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? '');
  const [productId, setProductId] = useState(task?.product_id ?? GENERAL);
  const [phase, setPhase] = useState<string>(task?.lifecycle_phase ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();

  // A task that already belongs to a product stays there: validate_product_task()
  // allows exactly one move, general → product, so offering the others would be
  // offering a control that always fails.
  const productLocked = Boolean(task?.product_id);
  // A subtask follows its parent, and a task already scoped into a release has
  // to leave that release first. Both are refused by the database.
  const adoptionBlocked =
    Boolean(task) &&
    !productLocked &&
    (task!.parent_task_id !== null || task!.release_id !== null);

  function changeProduct(next: string) {
    setProductId(next);
    // A phase names a row in product_lifecycle_phases, which is keyed by
    // product. Dropping back to General has to drop the phase with it or the
    // CHECK rejects the save with a constraint name nobody can act on.
    if (next === GENERAL) setPhase('');
  }

  function handleFiles(nextFiles: File[]) {
    const invalid = validateAttachmentFiles(nextFiles);
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
      const lifecyclePhase =
        phase === '' ? null : (phase as LifecyclePhase);

      const result = task
        ? await updateTaskAction(task.id, {
            title,
            notes: notes.trim() || null,
            dueDate: dueDate || null,
            assigneeId: assigneeId || null,
            status: task.status,
            lifecyclePhase,
            // Sent only when it actually changes, so an ordinary edit never
            // touches the column the trigger guards.
            ...(!productLocked && productId !== GENERAL ? {productId} : {})
          })
        : await createTaskAction({
            productId: productId === GENERAL ? null : productId,
            parentTaskId: null,
            title,
            notes: notes.trim() || null,
            dueDate: dueDate || null,
            assigneeId: assigneeId || null,
            lifecyclePhase
          });

      if (!result.ok) {
        onError(result.error);
        return;
      }

      // The database trigger has already written the notification rows; this
      // only pushes the ones that asked to be emailed. Deliberately not awaited
      // into the error path: a mail problem is not a task problem.
      void drainNotificationEmailsAction();

      if (!task && files.length > 0) {
        // A general task has no product to file its uploads under.
        const prefix =
          productId === GENERAL
            ? `tasks/${result.taskId}`
            : `products/${productId}/tasks/${result.taskId}`;
        let uploaded: StoredImage[] = [];
        try {
          uploaded = await uploadAttachments(files, prefix);
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
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-accent/20 bg-accent/[0.035] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          {task ? t('form.editTitle') : t('form.newTitle')}
        </h3>
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

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.product')}</span>
          <select
            value={productId}
            disabled={productLocked || adoptionBlocked}
            onChange={(event) => changeProduct(event.target.value)}
            className={`${INPUT_CLASS} disabled:opacity-60`}
          >
            <option value={GENERAL}>{t('form.generalTask')}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <span className="block text-[11px] text-faint">
            {productLocked
              ? t('form.productLockedHint')
              : adoptionBlocked
                ? t('form.productBlockedHint')
                : t('form.productHint')}
          </span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.lifecyclePhase')}</span>
          <select
            value={phase}
            disabled={productId === GENERAL}
            onChange={(event) => setPhase(event.target.value)}
            className={`${INPUT_CLASS} disabled:opacity-60`}
          >
            <option value="">{t('form.noPhase')}</option>
            {LIFECYCLE_PHASES.map((value) => (
              <option key={value} value={value}>
                {t(`phase.${value}`)}
              </option>
            ))}
          </select>
          <span className="block text-[11px] text-faint">
            {productId === GENERAL
              ? t('form.phaseNeedsProductHint')
              : t('form.phaseHint')}
          </span>
        </label>
      </div>

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
          <span className="text-xs text-muted">{t('form.attachments')}</span>
          <input
            ref={fileInput}
            type="file"
            accept={DOCUMENT_ACCEPT}
            multiple
            onChange={(event) =>
              handleFiles(Array.from(event.target.files ?? []))
            }
            className="block w-full text-xs text-muted file:me-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-2 file:text-xs file:font-medium file:text-ink hover:file:bg-hairline"
          />
          <span className="text-[11px] text-faint">
            {files.length > 0
              ? t('media.selectedFiles', {count: files.length})
              : t('form.attachmentsHint')}
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
          className="rounded-md border border-hairline px-3.5 py-2 text-sm text-muted transition-colors hover:text-ink"
        >
          {t('form.cancel')}
        </button>
      </div>
    </form>
  );
}
