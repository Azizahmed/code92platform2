import {Hourglass} from 'lucide-react';
import {useTranslations} from 'next-intl';

import type {DealStage, DealType} from '@/lib/sales/stages';
import {formatMoney} from '@/lib/sales/types';

export const STAGE_DOTS: Record<DealStage, string> = {
  lead: 'bg-faint',
  meeting: 'bg-muted',
  discovery_demo: 'bg-ink',
  proposal: 'bg-amber',
  negotiation: 'bg-amber',
  closed_won: 'bg-accent',
  closed_lost: 'bg-danger'
};

const STAGE_TONES: Record<DealStage, string> = {
  lead: 'border-hairline bg-raised text-muted',
  meeting: 'border-hairline bg-raised text-muted',
  discovery_demo: 'border-hairline bg-raised text-ink',
  proposal: 'border-amber/30 bg-amber/10 text-amber',
  negotiation: 'border-amber/30 bg-amber/10 text-amber',
  closed_won: 'border-accent/30 bg-accent/10 text-accent',
  closed_lost: 'border-danger/30 bg-danger/10 text-danger'
};

export function DealStageChip({stage}: {stage: DealStage}) {
  const t = useTranslations('sales');
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STAGE_TONES[stage]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOTS[stage]}`} />
      {t(`stages.${stage}`)}
    </span>
  );
}

export function DealTypeChip({type}: {type: DealType}) {
  const t = useTranslations('sales');
  return (
    <span className="inline-flex rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-faint">
      {t(`types.${type}`)}
    </span>
  );
}

export function StaleFlag() {
  const t = useTranslations('sales');
  return (
    <span title={t('staleHint')} className="inline-flex items-center gap-1 rounded border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-danger">
      <Hourglass className="h-2.5 w-2.5" strokeWidth={2} />
      {t('stale')}
    </span>
  );
}

export function Money({
  amount,
  currency,
  locale,
  className = ''
}: {
  amount: number | null;
  currency: string;
  locale: string;
  className?: string;
}) {
  if (amount === null) return <span className={`font-mono text-faint ${className}`}>—</span>;
  return <span className={`font-mono ${className}`}>{formatMoney(Number(amount), currency, locale)}</span>;
}
