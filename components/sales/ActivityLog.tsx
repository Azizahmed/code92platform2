'use client';

import {ArrowRight, MessageSquare, PencilLine, Sparkles} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useState} from 'react';

import RelativeTime from '@/components/RelativeTime';
import {addDealNoteAction} from '@/lib/actions/sales';
import {formatDay} from '@/lib/dates';
import type {DealActivity} from '@/lib/sales/types';
import {useServerAction} from '@/lib/use-server-action';

type Entry = DealActivity & {actor_name: string | null; deal_name?: string};

const ICONS = {
  created: Sparkles,
  stage_change: ArrowRight,
  field_change: PencilLine,
  note: MessageSquare
} as const;

function FieldChange({entry, locale, names}: {entry: Entry; locale: string; names: Map<string, string>}) {
  const t = useTranslations('sales');
  const meta = entry.meta;
  if (!meta) return null;
  const show = (value: string | null) => {
    if (value === null || value === '') return t('activity.empty');
    if (meta.field === 'owner_id') return names.get(value) ?? '—';
    if (meta.field.endsWith('date') || meta.field === 'expected_close') return formatDay(value, locale);
    if (meta.field === 'value_amount') return Number(value).toLocaleString(locale);
    return value;
  };
  return (
    <>
      {t(`activity.fields.${meta.field}`)}: <span className="text-faint line-through">{show(meta.from)}</span> → <span className="text-ink">{show(meta.to)}</span>
    </>
  );
}

// Deal history, newest first. On the deal page it also takes notes; on the
// account page (dealId omitted) it shows every deal's history with its name.
export default function ActivityLog({
  dealId,
  entries,
  names,
  locale
}: {
  dealId?: string;
  entries: Entry[];
  names: Record<string, string>;
  locale: string;
}) {
  const t = useTranslations('sales');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const nameMap = new Map(Object.entries(names));

  function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!dealId || !note.trim()) return;
    setError(null);
    void run(async () => {
      const result = await addDealNoteAction(dealId, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNote('');
    });
  }

  return (
    <div className="space-y-4">
      {dealId ? (
        <form onSubmit={addNote} className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={5000}
            placeholder={t('activity.notePlaceholder')}
            className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
          <div className="flex items-center justify-between gap-2">
            {error ? <span className="text-xs text-danger">{t(`errors.${error}`)}</span> : <span />}
            <button type="submit" disabled={pending || !note.trim()} className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
              {pending ? t('actions.saving') : t('activity.addNote')}
            </button>
          </div>
        </form>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-xs text-faint">{t('activity.none')}</p>
      ) : (
        <ol className="relative space-y-4 border-s border-hairline ps-4">
          {entries.map((entry) => {
            const Icon = ICONS[entry.kind];
            return (
              <li key={entry.id} className="relative">
                <span className="absolute -start-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-hairline bg-panel text-faint">
                  <Icon className="h-2.5 w-2.5 rtl:-scale-x-100" strokeWidth={2} />
                </span>
                <div className="text-xs text-muted">
                  <span className="text-ink">{entry.actor_name ?? t('activity.system')}</span>{' '}
                  {entry.kind === 'created' ? t('activity.created', {stage: t(`stages.${entry.to_stage ?? 'lead'}`)}) : null}
                  {entry.kind === 'stage_change' && entry.from_stage && entry.to_stage
                    ? t('activity.moved', {from: t(`stages.${entry.from_stage}`), to: t(`stages.${entry.to_stage}`)})
                    : null}
                  {entry.kind === 'field_change' ? <FieldChange entry={entry} locale={locale} names={nameMap} /> : null}
                  {entry.kind === 'note' ? t('activity.noted') : null}
                  {entry.deal_name ? <span className="text-faint"> · {entry.deal_name}</span> : null}
                </div>
                {entry.reason ? <p className="mt-1 rounded border border-hairline bg-bg px-2 py-1 text-xs text-muted">{t('activity.reason')}: {entry.reason}</p> : null}
                {entry.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{entry.body}</p> : null}
                <div className="mt-0.5 text-[11px] text-faint">
                  <RelativeTime date={entry.created_at} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
