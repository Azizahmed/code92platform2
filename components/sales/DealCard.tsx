import {CalendarClock, UserRound} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {DealTypeChip, Money, StaleFlag} from '@/components/sales/chips';
import {Link} from '@/i18n/navigation';
import {dueState, formatDay} from '@/lib/dates';
import type {DealRow} from '@/lib/sales/types';

// Kanban card: account, owner, value, next-action date, type chip, stale flag.
export default function DealCard({deal, today, locale}: {deal: DealRow; today: string; locale: string}) {
  const t = useTranslations('sales');
  const state = deal.is_open ? dueState(deal.next_action_date, today) : 'none';

  return (
    <article
      className={`cursor-grab rounded-md border bg-bg px-3 py-2.5 transition-colors hover:border-accent/30 active:cursor-grabbing ${
        deal.is_stale ? 'border-danger/30' : 'border-hairline'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted">{deal.account_name}</span>
        <DealTypeChip type={deal.type} />
      </div>
      <Link
        href={`/sales/deals/${deal.id}`}
        onPointerDown={(event) => event.stopPropagation()}
        className="mt-1 block text-sm font-medium leading-snug text-ink transition-colors hover:text-accent"
      >
        {deal.name}
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex min-w-0 items-center gap-1 text-faint">
          <UserRound className="h-3 w-3 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{deal.owner_name ?? '—'}</span>
        </span>
        <Money amount={deal.value_amount} currency={deal.currency} locale={locale} className="shrink-0 text-xs text-ink" />
      </div>
      {deal.is_open ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
          {deal.next_action_date ? (
            <span className={`inline-flex items-center gap-1 font-mono ${state === 'overdue' ? 'text-amber' : state === 'today' ? 'text-accent' : 'text-muted'}`}>
              <CalendarClock className="h-3 w-3" strokeWidth={1.75} />
              {formatDay(deal.next_action_date, locale)}
            </span>
          ) : (
            <span className="text-faint">{t('card.noNextAction')}</span>
          )}
          {deal.is_stale ? <StaleFlag /> : null}
        </div>
      ) : null}
    </article>
  );
}
