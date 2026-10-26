'use client';

import {CalendarClock, Pencil} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useState} from 'react';

import {setDealNextActionAction} from '@/lib/actions/sales';
import {dueState, formatDay} from '@/lib/dates';
import {useServerAction} from '@/lib/use-server-action';

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

export default function NextActionEditor({
  dealId,
  nextAction,
  nextActionDate,
  isOpen,
  isStale,
  today,
  locale
}: {
  dealId: string;
  nextAction: string | null;
  nextActionDate: string | null;
  isOpen: boolean;
  isStale: boolean;
  today: string;
  locale: string;
}) {
  const t = useTranslations('sales');
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState(nextAction ?? '');
  const [date, setDate] = useState(nextActionDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    void run(async () => {
      const result = await setDealNextActionAction(dealId, {
        nextAction: action || null,
        nextActionDate: date || null
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <form onSubmit={save} className="space-y-3">
        <input value={action} onChange={(e) => setAction(e.target.value)} maxLength={500} autoFocus placeholder={t('fields.nextActionPlaceholder')} className={INPUT_CLASS} />
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('fields.nextActionDate')} className={`${INPUT_CLASS} w-auto font-mono`} />
          <div className="ms-auto flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
              {t('actions.cancel')}
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
              {pending ? t('actions.saving') : t('actions.save')}
            </button>
          </div>
        </div>
        {error ? <p className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
      </form>
    );
  }

  const state = isOpen ? dueState(nextActionDate, today) : 'none';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {nextAction ? (
          <p className="text-sm text-ink">{nextAction}</p>
        ) : (
          <p className={`text-sm ${isOpen ? 'text-amber' : 'text-faint'}`}>{t('card.noNextAction')}</p>
        )}
        {nextActionDate ? (
          <p className={`mt-1 inline-flex items-center gap-1 font-mono text-xs ${state === 'overdue' ? 'text-amber' : state === 'today' ? 'text-accent' : 'text-muted'}`}>
            <CalendarClock className="h-3 w-3" strokeWidth={1.75} />
            {formatDay(nextActionDate, locale)}
          </p>
        ) : null}
        {isStale ? <p className="mt-1.5 text-[11px] text-danger">{t('staleHint')}</p> : null}
      </div>
      <button type="button" onClick={() => setEditing(true)} aria-label={t('actions.editNextAction')} className="shrink-0 rounded-md border border-hairline p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink">
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
