'use client';

import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import {
  addChecklistItemAction,
  deleteChecklistItemAction,
  setChecklistItemDoneAction
} from '@/lib/actions/business';
import {BUSINESS_STAGES, type BusinessStage} from '@/lib/business-track';
import {useServerAction} from '@/lib/use-server-action';

export type ChecklistRow = {
  id: string;
  stage: BusinessStage;
  label: string;
  default_key: string | null;
  done: boolean;
  done_at: string | null;
  done_by_name: string | null;
};

// Guides, never blocks: ticking an item records who and when, and nothing here
// stops a move. Every stage has its own list; the current one opens first.
export default function ChecklistPanel({
  productId,
  currentStage,
  rows,
  canEdit
}: {
  productId: string;
  currentStage: BusinessStage;
  rows: ChecklistRow[];
  canEdit: boolean;
}) {
  const t = useTranslations('business');

  function labelFor(row: ChecklistRow): string {
    const key = `checklist.defaults.${row.default_key}`;
    return row.default_key && t.has(key) ? t(key) : row.label;
  }

  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t('checklist.title')}</h2>
        <p className="text-[11px] text-faint">{t('checklist.guidance')}</p>
      </header>

      {BUSINESS_STAGES.map((stage) => {
        const items = rows
          .filter((row) => row.stage === stage)
          .sort((a, b) => a.label.localeCompare(b.label));
        const doneCount = items.filter((row) => row.done).length;
        return (
          <details key={stage} open={stage === currentStage} className="group rounded-md border border-hairline">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className={stage === currentStage ? 'font-medium text-accent' : 'text-muted'}>
                {t(`stages.${stage}`)}
                {stage === currentStage ? ` · ${t('checklist.current')}` : ''}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {doneCount}/{items.length}
              </span>
            </summary>
            <ul className="space-y-1 border-t border-hairline p-2">
              {items.map((row) => (
                <ChecklistItem
                  key={row.id}
                  row={row}
                  label={labelFor(row)}
                  canEdit={canEdit}
                />
              ))}
              {items.length === 0 ? (
                <li className="px-1 py-1 text-[11px] text-faint">{t('checklist.empty')}</li>
              ) : null}
            </ul>
            {canEdit ? <AddItem productId={productId} stage={stage} /> : null}
          </details>
        );
      })}
    </section>
  );
}

function ChecklistItem({
  row,
  label,
  canEdit
}: {
  row: ChecklistRow;
  label: string;
  canEdit: boolean;
}) {
  const t = useTranslations('business');
  const [pending, run] = useServerAction();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex items-start gap-2 px-1 py-1">
      <input
        type="checkbox"
        checked={row.done}
        disabled={!canEdit || pending}
        onChange={(event) => {
          setError(null);
          void run(async () => {
            const result = await setChecklistItemDoneAction(row.id, event.target.checked);
            if (!result.ok) setError(result.error);
          });
        }}
        className="mt-0.5 accent-accent"
        aria-label={label}
      />
      <span className="min-w-0 flex-1">
        <span className={`block text-xs ${row.done ? 'text-faint line-through' : 'text-ink'}`}>{label}</span>
        {row.done && row.done_at ? (
          <span className="block text-[10px] text-faint">
            {t('checklist.doneBy', {name: row.done_by_name ?? '—'})} · <RelativeTime date={row.done_at} />
          </span>
        ) : null}
        {error ? <span role="alert" className="block text-[10px] text-danger">{t(`errors.${error}`)}</span> : null}
      </span>
      {canEdit && row.default_key === null ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t('checklist.removeConfirm'))) return;
            void run(async () => {
              const result = await deleteChecklistItemAction(row.id);
              if (!result.ok) setError(result.error);
            });
          }}
          aria-label={t('checklist.remove')}
          title={t('checklist.remove')}
          className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-danger"
        >
          <Trash2 className="h-3 w-3" strokeWidth={1.75} />
        </button>
      ) : null}
    </li>
  );
}

function AddItem({productId, stage}: {productId: string; stage: BusinessStage}) {
  const t = useTranslations('business');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  return (
    <form
      className="flex gap-2 border-t border-hairline p-2"
      onSubmit={(event) => {
        event.preventDefault();
        const text = label.trim();
        if (!text) return;
        setError(null);
        void run(async () => {
          const result = await addChecklistItemAction({productId, stage, label: text});
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setLabel('');
        });
      }}
    >
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        maxLength={200}
        placeholder={t('checklist.addPlaceholder')}
        aria-label={t('checklist.add')}
        className="min-w-0 flex-1 rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-xs outline-none placeholder:text-faint focus:border-accent/50"
      />
      <button
        type="submit"
        disabled={pending || label.trim().length === 0}
        className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
      >
        {t('checklist.add')}
      </button>
      {error ? <span role="alert" className="self-center text-[10px] text-danger">{t(`errors.${error}`)}</span> : null}
    </form>
  );
}
