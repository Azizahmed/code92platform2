'use client';

import {useEffect, useState} from 'react';
import {CheckCircle2, X} from 'lucide-react';
import {useTranslations} from 'next-intl';

// Asked once, at the only moment somebody has the whole task in their head.
//
// The note is not forced: a task that genuinely needed no explanation should
// not sit half-finished because the dialog would not let go. But the primary
// button is the one that records something, and skipping is the quiet link —
// the default should be the useful outcome, not the fast one.
export default function TaskCompletionDialog({
  taskTitle,
  initialNote,
  pending,
  onCancel,
  onConfirm
}: {
  taskTitle: string;
  initialNote?: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (note: string | null) => void;
}) {
  const t = useTranslations('tasks');
  const [note, setNote] = useState(initialNote ?? '');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onCancel]);

  const trimmed = note.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('completion.dialogTitle')}
      className="fixed inset-0 z-50 flex items-end justify-center p-3 md:items-center"
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label={t('completion.cancel')}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />

      {/* Centred with flex rather than a translate, which is physical and would
          need an rtl: patch to sit correctly in Arabic. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(trimmed || null);
        }}
        className="relative w-full rounded-2xl border border-hairline bg-panel p-4 shadow-2xl md:w-[32rem]"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CheckCircle2
                className="h-4 w-4 shrink-0 text-accent"
                strokeWidth={1.75}
              />
              <span className="text-sm font-semibold">
                {t('completion.dialogTitle')}
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-faint">{taskTitle}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('completion.cancel')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('completion.prompt')}</span>
          <textarea
            autoFocus
            rows={5}
            maxLength={5000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('completion.placeholder')}
            className="w-full resize-y rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
        </label>
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
          {t('completion.hint')}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || trimmed.length === 0}
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? t('completion.saving') : t('completion.confirm')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(null)}
            disabled={pending}
            className="text-xs text-muted underline-offset-2 transition-colors hover:text-ink hover:underline disabled:opacity-50"
          >
            {t('completion.skip')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="ms-auto rounded-md border border-hairline px-3.5 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            {t('completion.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
