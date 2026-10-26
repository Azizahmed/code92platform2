import {
  AtSign,
  CalendarClock,
  DoorOpen,
  Hourglass,
  PartyPopper,
  Sparkles,
  Timer
} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {Link} from '@/i18n/navigation';
import {formatDay} from '@/lib/dates';

import type {WaitingItem, WaitingSource} from './MyWorkView';

const SOURCES: Record<WaitingSource, {icon: typeof Sparkles; tone: string}> = {
  gate_ready: {icon: DoorOpen, tone: 'border-accent/30 bg-accent/10 text-accent'},
  proposal_pending: {icon: Sparkles, tone: 'border-accent/30 bg-accent/10 text-accent'},
  review_overdue: {icon: CalendarClock, tone: 'border-amber/30 bg-amber/10 text-amber'},
  mention_unreplied: {icon: AtSign, tone: 'border-hairline bg-raised text-muted'},
  deal_stale: {icon: Hourglass, tone: 'border-danger/30 bg-danger/10 text-danger'},
  deal_closing: {icon: Timer, tone: 'border-amber/30 bg-amber/10 text-amber'}
};

function hrefFor(item: WaitingItem): string {
  switch (item.source) {
    case 'gate_ready':
      return `/products/${item.context_id}`;
    case 'review_overdue':
      return `/products/${item.record_id}`;
    case 'proposal_pending':
    case 'mention_unreplied':
      return `/channels/${item.context_id}`;
    case 'deal_stale':
    case 'deal_closing':
      return `/sales/deals/${item.record_id}`;
  }
}

// Items that need the caller's decision. They leave the list on their own once
// resolved: the phase advanced, the proposal decided, the update posted, the
// thread answered, the next action set, the deal closed.
export default function WaitingList({
  items,
  today,
  locale
}: {
  items: WaitingItem[];
  today: string;
  locale: string;
}) {
  const t = useTranslations('myWork');
  const tLifecycle = useTranslations('lifecycle');

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-14 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
          <PartyPopper className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <h2 className="mt-3 text-sm font-medium">{t('empty.waitingTitle')}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">{t('empty.waitingBody')}</p>
      </div>
    );
  }

  function detail(item: WaitingItem): string | null {
    switch (item.source) {
      case 'gate_ready':
        return item.subtitle
          ? t('waiting.gatePhase', {phase: tLifecycle(`phases.${item.subtitle}`)})
          : null;
      case 'proposal_pending':
        return item.subtitle ? t(`waiting.proposalActions.${item.subtitle}`) : null;
      default:
        return item.subtitle;
    }
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-hairline bg-panel">
      {items.map((item) => {
        const {icon: Icon, tone} = SOURCES[item.source];
        const date = item.due_on ? formatDay(item.due_on, locale) : null;
        const extra = detail(item);
        return (
          <li key={`${item.source}:${item.record_id}`} className="border-b border-hairline last:border-0">
            <Link href={hrefFor(item)} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-raised/35">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${tone}`}>
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {t(`waiting.sources.${item.source}`)}
                  {extra ? ` · ${extra}` : ''}
                </span>
              </span>
              {date ? (
                <span className={`shrink-0 font-mono text-xs ${item.due_on && item.due_on < today && item.source !== 'deal_closing' ? 'text-amber' : 'text-muted'}`}>
                  {t(`waiting.when.${item.source}`, {date})}
                </span>
              ) : null}
              <span className="hidden shrink-0 rounded-md border border-hairline px-2.5 py-1 text-xs text-muted sm:inline">
                {t(`waiting.actions.${item.source}`)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
