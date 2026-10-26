import {useTranslations} from 'next-intl';

import {DealStageChip, DealTypeChip, Money, StaleFlag} from '@/components/sales/chips';
import {Link} from '@/i18n/navigation';
import {dueState, formatDay} from '@/lib/dates';
import type {DealRow} from '@/lib/sales/types';

// List view of the same deals as the kanban.
export default function DealsTable({
  deals,
  today,
  locale,
  hideAccount = false
}: {
  deals: DealRow[];
  today: string;
  locale: string;
  hideAccount?: boolean;
}) {
  const t = useTranslations('sales');

  if (deals.length === 0) {
    return <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-xs text-faint">{t('empty.deals')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-hairline bg-raised/30 text-[10px] uppercase tracking-widest text-faint">
            <th className="px-4 py-2.5 text-start font-normal">{t('columns.deal')}</th>
            <th className="px-3 py-2.5 text-start font-normal">{t('columns.stage')}</th>
            <th className="px-3 py-2.5 text-start font-normal">{t('columns.owner')}</th>
            <th className="px-3 py-2.5 text-end font-normal">{t('columns.value')}</th>
            <th className="px-3 py-2.5 text-start font-normal">{t('columns.nextAction')}</th>
            <th className="px-4 py-2.5 text-start font-normal">{t('columns.expectedClose')}</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const state = deal.is_open ? dueState(deal.next_action_date, today) : 'none';
            return (
              <tr key={deal.id} className="border-b border-hairline transition-colors last:border-0 hover:bg-raised/35">
                <td className="max-w-[18rem] px-4 py-2.5">
                  <Link href={`/sales/deals/${deal.id}`} className="block truncate font-medium text-ink transition-colors hover:text-accent">
                    {deal.name}
                  </Link>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
                    {hideAccount ? null : <span className="truncate">{deal.account_name}</span>}
                    <DealTypeChip type={deal.type} />
                    {deal.product_name ? <span className="truncate">{deal.product_name}</span> : null}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <DealStageChip stage={deal.stage} />
                    {deal.is_stale ? <StaleFlag /> : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted">{deal.owner_name ?? '—'}</td>
                <td className="px-3 py-2.5 text-end">
                  <Money amount={deal.value_amount} currency={deal.currency} locale={locale} className="text-xs text-ink" />
                </td>
                <td className="max-w-[14rem] px-3 py-2.5 text-xs">
                  {deal.is_open && deal.next_action ? (
                    <>
                      <span className="block truncate text-muted">{deal.next_action}</span>
                      {deal.next_action_date ? (
                        <span className={`font-mono text-[11px] ${state === 'overdue' ? 'text-amber' : state === 'today' ? 'text-accent' : 'text-faint'}`}>
                          {formatDay(deal.next_action_date, locale)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-faint">{deal.is_open ? t('card.noNextAction') : '—'}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted">
                  {deal.expected_close ? formatDay(deal.expected_close, locale) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
