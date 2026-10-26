'use client';

import {AlarmClock, CalendarRange, Coins, Columns3, Handshake, Hourglass, List} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useEffect, useMemo, useState} from 'react';

import KanbanBoard from '@/components/kanban/KanbanBoard';
import DealCard from '@/components/sales/DealCard';
import DealsTable from '@/components/sales/DealsTable';
import StageMoveDialog, {needsDialog, type StageMoveRequest} from '@/components/sales/StageMoveDialog';
import {STAGE_DOTS} from '@/components/sales/chips';
import {moveDealStageAction} from '@/lib/actions/sales';
import {monthRange} from '@/lib/dates';
import {DEAL_STAGES, type DealStage} from '@/lib/sales/stages';
import {formatMoney, sumByCurrency, type DealRow, type MemberOption, type ProductOption} from '@/lib/sales/types';
import {useServerAction} from '@/lib/use-server-action';

type Filters = {
  type: 'all' | 'product' | 'consultation';
  owner: string; // 'all' | 'me' | user id
  product: string; // 'all' | product id
  view: 'kanban' | 'list';
};

const SELECT_CLASS =
  'rounded-md border border-hairline bg-bg px-2.5 py-2 text-xs text-muted outline-none transition-colors focus:border-accent/50';

function applyStage(deals: DealRow[], move: {dealId: string; stage: DealStage}): DealRow[] {
  return deals.map((deal) =>
    deal.id === move.dealId
      ? {
          ...deal,
          stage: move.stage,
          is_open: move.stage !== 'closed_won' && move.stage !== 'closed_lost',
          is_stale: move.stage === 'closed_won' || move.stage === 'closed_lost' ? false : deal.is_stale
        }
      : deal
  );
}

export default function SalesBoard({
  deals,
  members,
  products,
  initialFilters,
  currentUserId,
  today,
  locale
}: {
  deals: DealRow[];
  members: MemberOption[];
  products: ProductOption[];
  initialFilters: Filters;
  currentUserId: string;
  today: string;
  locale: string;
}) {
  const t = useTranslations('sales');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [dialog, setDialog] = useState<StageMoveRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, run] = useServerAction();
  // Optimistic stage moves, kept until the server's fresh render arrives.
  const [moves, setMoves] = useState<Record<string, DealStage>>({});
  useEffect(() => setMoves({}), [deals]);
  const optimisticDeals = useMemo(
    () =>
      Object.entries(moves).reduce(
        (list, [dealId, stage]) => applyStage(list, {dealId, stage}),
        deals
      ),
    [deals, moves]
  );

  function updateFilters(next: Partial<Filters>) {
    const merged = {...filters, ...next};
    setFilters(merged);
    // Shareable without a server round trip: data is already loaded.
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(merged)) {
      const isDefault = key === 'view' ? value === 'kanban' : value === 'all';
      if (isDefault) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(null, '', url);
  }

  const visible = useMemo(
    () =>
      optimisticDeals.filter((deal) => {
        if (filters.type !== 'all' && deal.type !== filters.type) return false;
        if (filters.owner === 'me' && deal.owner_id !== currentUserId) return false;
        if (filters.owner !== 'all' && filters.owner !== 'me' && deal.owner_id !== filters.owner) return false;
        if (filters.product !== 'all' && deal.product_id !== filters.product) return false;
        return true;
      }),
    [optimisticDeals, filters, currentUserId]
  );

  // Counters follow the filters so "my pipeline" is one click away.
  const open = visible.filter((deal) => deal.is_open);
  const month = monthRange(today);
  const closingThisMonth = open.filter(
    (deal) => deal.expected_close && deal.expected_close >= month.start && deal.expected_close <= month.end
  ).length;
  const stale = open.filter((deal) => deal.is_stale).length;
  const openValue = sumByCurrency(open);

  function requestMove(deal: DealRow, to: DealStage) {
    setError(null);
    const request: StageMoveRequest = {dealId: deal.id, dealName: deal.name, type: deal.type, from: deal.stage, to};
    if (needsDialog(request)) {
      setDialog(request);
      return;
    }
    setMoves((current) => ({...current, [deal.id]: to}));
    void run(async () => {
      const result = await moveDealStageAction({dealId: deal.id, toStage: to, reason: null, ownership: null});
      if (!result.ok) {
        setError(result.error);
        setMoves((current) => {
          const next = {...current};
          delete next[deal.id];
          return next;
        });
      }
    });
  }

  const counters = [
    {key: 'openDeals', icon: Handshake, value: String(open.length), tone: 'text-ink'},
    {
      key: 'openValue',
      icon: Coins,
      value:
        openValue.length === 0
          ? '—'
          : openValue.map(([currency, amount]) => formatMoney(amount, currency, locale)).join(' · '),
      tone: 'text-accent'
    },
    {key: 'closingThisMonth', icon: CalendarRange, value: String(closingThisMonth), tone: closingThisMonth > 0 ? 'text-amber' : 'text-ink'},
    {key: 'stale', icon: stale > 0 ? AlarmClock : Hourglass, value: String(stale), tone: stale > 0 ? 'text-danger' : 'text-ink'}
  ] as const;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counters.map(({key, icon: Icon, value, tone}) => (
          <div key={key} className="min-w-0 rounded-lg border border-hairline bg-panel px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-widest text-faint">{t(`counters.${key}`)}</span>
              <Icon className={`h-4 w-4 ${tone}`} strokeWidth={1.75} />
            </div>
            <div className={`mt-2 truncate font-mono text-2xl font-medium ${tone}`} title={value}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-panel p-3">
        <select aria-label={t('filters.type')} value={filters.type} onChange={(e) => updateFilters({type: e.target.value as Filters['type']})} className={SELECT_CLASS}>
          <option value="all">{t('filters.allTypes')}</option>
          <option value="product">{t('types.product')}</option>
          <option value="consultation">{t('types.consultation')}</option>
        </select>
        <select aria-label={t('filters.owner')} value={filters.owner} onChange={(e) => updateFilters({owner: e.target.value})} className={SELECT_CLASS}>
          <option value="all">{t('filters.allOwners')}</option>
          <option value="me">{t('filters.mine')}</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
            </option>
          ))}
        </select>
        <select aria-label={t('filters.product')} value={filters.product} onChange={(e) => updateFilters({product: e.target.value})} className={SELECT_CLASS}>
          <option value="all">{t('filters.allProducts')}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>

        <div className="ms-auto flex items-center gap-1 rounded-md border border-hairline bg-bg p-1">
          {(
            [
              {value: 'kanban', icon: Columns3},
              {value: 'list', icon: List}
            ] as const
          ).map(({value, icon: Icon}) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.view === value}
              onClick={() => updateFilters({view: value})}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                filters.view === value ? 'bg-raised text-ink' : 'text-faint hover:text-muted'
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t(`views.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {deals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-14 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
            <Handshake className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-3 text-sm font-medium">{t('empty.pipelineTitle')}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">{t('empty.pipelineBody')}</p>
        </div>
      ) : filters.view === 'kanban' ? (
        <KanbanBoard
          columns={DEAL_STAGES.map((stage) => ({id: stage, label: t(`stages.${stage}`), dot: STAGE_DOTS[stage]}))}
          items={visible}
          getId={(deal) => deal.id}
          getColumn={(deal) => deal.stage}
          onMove={requestMove}
          emptyLabel={t('empty.column')}
          instructions={t('kanbanInstructions')}
          columnMinWidth="13.5rem"
          renderCard={(deal) => <DealCard deal={deal} today={today} locale={locale} />}
        />
      ) : (
        <DealsTable deals={visible} today={today} locale={locale} />
      )}

      {dialog ? <StageMoveDialog request={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
