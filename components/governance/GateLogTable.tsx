import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import RiskTierChip from '@/components/lifecycle/RiskTierChip';
import {Link} from '@/i18n/navigation';
import type {PhaseTransition} from '@/lib/actions/lifecycle';

// The audit trail, rendered two ways: the full gate log, and the waiver
// register (same shape, pre-filtered to transitions that carry a reason).
// "All decisions logged with reasoning" is the whole point, so the reason and
// the self-approval flag are first-class columns, not tooltips.
export default function GateLogTable({
  transitions,
  productNames,
  memberNames,
  emptyMessage
}: {
  transitions: PhaseTransition[];
  productNames: Record<string, string>;
  memberNames: Record<string, string>;
  emptyMessage: string;
}) {
  const t = useTranslations('lifecycle');

  if (transitions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-10 text-center text-sm text-muted">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-hairline text-[10px] uppercase tracking-widest text-faint">
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.when')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.product')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.change')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.actor')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.reason')}
            </th>
          </tr>
        </thead>
        <tbody>
          {transitions.map((transition) => (
            <tr
              key={transition.id}
              className="border-b border-hairline align-top transition-colors last:border-0 hover:bg-raised/60"
            >
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                <RelativeTime date={transition.created_at} />
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/products/${transition.product_id}`}
                  className="text-xs font-medium text-ink transition-colors hover:text-accent"
                >
                  {productNames[transition.product_id] ?? '—'}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {transition.from_state
                    ? t('governance.transition', {
                        phase: t(`phases.${transition.phase}`),
                        from: t(`states.${transition.from_state}`),
                        to: t(`states.${transition.to_state}`)
                      })
                    : t('governance.transitionInitial', {
                        phase: t(`phases.${transition.phase}`),
                        to: t(`states.${transition.to_state}`)
                      })}
                  <RiskTierChip riskTier={transition.risk_tier_at_time} />
                </span>
                {transition.missing_artifacts.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {transition.missing_artifacts.map((type) => (
                      <span
                        key={type}
                        className="rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-amber"
                      >
                        {t(`artifacts.types.${type}`)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs text-muted">
                  {memberNames[transition.actor_id] ?? '—'}
                </span>
                {transition.self_approved ? (
                  <span
                    title={t('gate.selfApprovedHint')}
                    className="mt-1 block w-fit rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber"
                  >
                    {t('gate.selfApproved')}
                  </span>
                ) : null}
              </td>
              <td className="max-w-xs px-4 py-3">
                {transition.waiver_reason ? (
                  <p dir="auto" className="text-xs leading-relaxed text-muted">
                    {transition.waiver_reason}
                  </p>
                ) : (
                  <span className="text-xs text-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
