import {ShieldAlert} from 'lucide-react';
import {useTranslations} from 'next-intl';

import type {RiskTier} from '@/lib/lifecycle';

// The tier drives every gate on the product, so it earns colour: medium warns,
// high reads as a hard constraint.
const STYLES: Record<RiskTier, string> = {
  low: 'border-hairline bg-raised text-muted',
  medium: 'border-amber/30 bg-amber/10 text-amber',
  high: 'border-danger/40 bg-danger/10 text-danger'
};

export default function RiskTierChip({riskTier}: {riskTier: RiskTier}) {
  const t = useTranslations('lifecycle');

  return (
    <span
      title={t('risk.hint')}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STYLES[riskTier]}`}
    >
      <ShieldAlert className="h-3 w-3 shrink-0" strokeWidth={2} />
      {t(`risk.short.${riskTier}`)}
    </span>
  );
}
