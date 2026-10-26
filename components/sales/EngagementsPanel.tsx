'use client';

import {Pencil} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useState} from 'react';

import {Link} from '@/i18n/navigation';
import {updateEngagementAction} from '@/lib/actions/sales';
import {formatDay} from '@/lib/dates';
import {OWNERSHIP_OPTIONS, type Ownership} from '@/lib/sales/stages';
import type {Engagement} from '@/lib/sales/types';
import {useServerAction} from '@/lib/use-server-action';

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent/50';

function EngagementRow({engagement, locale}: {engagement: Engagement; locale: string}) {
  const t = useTranslations('sales');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(engagement.name);
  const [ownership, setOwnership] = useState<Ownership>(engagement.ownership);
  const [notes, setNotes] = useState(engagement.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  function save(event: React.FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await updateEngagementAction(engagement.id, {name, ownership, notes: notes || null});
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <form onSubmit={save} className="space-y-2 rounded-md border border-hairline bg-bg/40 p-3">
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} aria-label={t('engagements.name')} className={INPUT_CLASS} />
        <select value={ownership} onChange={(e) => setOwnership(e.target.value as Ownership)} aria-label={t('move.ownership')} className={INPUT_CLASS}>
          {OWNERSHIP_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`ownership.${option}`)}
            </option>
          ))}
        </select>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} placeholder={t('engagements.notes')} aria-label={t('engagements.notes')} className={INPUT_CLASS} />
        {error ? <p className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted hover:bg-raised hover:text-ink">
            {t('actions.cancel')}
          </button>
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50">
            {pending ? t('actions.saving') : t('actions.save')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-hairline px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-ink">{engagement.name}</div>
        <div className="mt-0.5 text-xs text-muted">{t(`ownership.${engagement.ownership}`)}</div>
        <div className="mt-0.5 flex gap-2 text-[11px] text-faint">
          <span className="font-mono">{formatDay(engagement.started_at.slice(0, 10), locale)}</span>
          {engagement.deal_id ? (
            <Link href={`/sales/deals/${engagement.deal_id}`} className="hover:text-accent">
              {t('engagements.fromDeal')}
            </Link>
          ) : null}
        </div>
        {engagement.notes ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{engagement.notes}</p> : null}
      </div>
      <button type="button" onClick={() => setEditing(true)} aria-label={t('actions.edit')} className="shrink-0 rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink">
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export default function EngagementsPanel({engagements, locale}: {engagements: Engagement[]; locale: string}) {
  const t = useTranslations('sales');
  if (engagements.length === 0) return <p className="text-xs text-faint">{t('engagements.none')}</p>;
  return (
    <div className="space-y-2">
      {engagements.map((engagement) => (
        <EngagementRow key={engagement.id} engagement={engagement} locale={locale} />
      ))}
      <p className="text-[11px] text-faint">{t('engagements.later')}</p>
    </div>
  );
}
