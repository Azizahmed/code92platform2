import {GitBranch} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {Link} from '@/i18n/navigation';
import type {LifecyclePhase} from '@/lib/lifecycle';

// "Where is this information coming from."
//
// A knowledge item that was filed as lifecycle evidence says so, names the
// product and the phase, and links back to the place it was filed. Without
// this a mirrored PRD is indistinguishable from one somebody pasted in, and
// the reader has no way to tell whether they are looking at the governed
// document or a copy of it.
export default function ProvenanceChip({
  productId,
  productName,
  phase,
  artifactType,
  compact = false
}: {
  productId: string;
  productName: string;
  phase: LifecyclePhase;
  artifactType: string;
  compact?: boolean;
}) {
  const t = useTranslations('knowledge');
  const tl = useTranslations('lifecycle');

  const label = t('provenance.chip', {
    product: productName,
    phase: tl(`phases.${phase}`)
  });

  return (
    <Link
      href={`/products/${productId}#lifecycle`}
      title={t('provenance.tooltip', {
        type: tl(`artifacts.types.${artifactType}`)
      })}
      className={`inline-flex max-w-full items-center gap-1.5 rounded border border-accent/25 bg-accent/[0.07] text-accent transition-colors hover:border-accent/50 hover:bg-accent/10 ${
        compact
          ? 'px-1.5 py-0.5 text-[10px]'
          : 'px-2 py-1 text-[11px]'
      }`}
    >
      <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
      {!compact ? (
        <span className="shrink-0 border-s border-accent/25 ps-1.5 font-mono text-[10px] opacity-80">
          {tl(`artifacts.types.${artifactType}`)}
        </span>
      ) : null}
    </Link>
  );
}
