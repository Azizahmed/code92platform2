import {useTranslations} from 'next-intl';

import LifecycleBarCompact from '@/components/lifecycle/LifecycleBarCompact';
import RiskTierChip from '@/components/lifecycle/RiskTierChip';
import {Link} from '@/i18n/navigation';
import {LIFECYCLE_PHASES} from '@/lib/lifecycle';
import type {LifecycleOverviewRow} from '@/lib/lifecycle-queries';

// Portfolio-wide artifact coverage: which products are carrying gaps against
// the requirements their risk tier implies. Sorted gaps-first by the query.
export default function CoverageTable({rows}: {rows: LifecycleOverviewRow[]}) {
  const t = useTranslations('lifecycle');

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-10 text-center text-sm text-muted">
        {t('governance.coverageEmpty')}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-hairline text-[10px] uppercase tracking-widest text-faint">
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.product')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.risk')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.phase')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.progress')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.gaps')}
            </th>
            <th className="px-4 py-2.5 text-start font-medium">
              {t('governance.columns.owner')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.product_id}
              className="border-b border-hairline transition-colors last:border-0 hover:bg-raised/60"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/products/${row.product_id}`}
                  className="font-medium text-ink transition-colors hover:text-accent"
                >
                  {row.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <RiskTierChip riskTier={row.risk_tier} />
              </td>
              <td className="px-4 py-3">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted">
                    {row.current_phase
                      ? t(`phases.${row.current_phase}`)
                      : '—'}
                  </span>
                  {row.is_blocked ? (
                    <span className="rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-danger">
                      {t('states.blocked')}
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="min-w-40 px-4 py-3">
                <div className="space-y-1.5">
                  <LifecycleBarCompact
                    phase={row.current_phase}
                    state={
                      (row.current_state as
                        | 'not_started'
                        | 'in_progress'
                        | 'blocked'
                        | 'complete'
                        | null) ?? null
                    }
                    completeCount={row.phases_complete}
                  />
                  <span className="block text-[10px] text-faint">
                    {t('governance.complete', {
                      done: row.phases_complete,
                      total: LIFECYCLE_PHASES.length
                    })}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                    row.missing_required_count > 0
                      ? 'border-amber/40 bg-amber/10 text-amber'
                      : 'border-hairline text-faint'
                  }`}
                >
                  {row.missing_required_count}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {row.owner_name ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
