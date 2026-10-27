import {getTranslations} from 'next-intl/server';

import ReleaseStatusChip from '@/components/releases/ReleaseStatusChip';
import RiskTierChip from '@/components/risk/RiskTierChip';
import {Link} from '@/i18n/navigation';
import type {ReleaseOverview} from '@/lib/releases';

// Every release that is still moving, and how much of the evidence its current
// stage needs is on file. A gap here is what the next move will be refused for.
export default async function CoverageTable({rows}: {rows: ReleaseOverview[]}) {
  const t = await getTranslations('governance');
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-10 text-center text-sm text-muted">{t('coverage.empty')}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-hairline bg-raised/30 text-[10px] uppercase tracking-widest text-faint">
            <th className="px-4 py-2.5 text-start font-medium">{t('coverage.release')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('coverage.stage')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('coverage.status')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('coverage.filed')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('coverage.gaps')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-hairline last:border-0">
              <td className="px-4 py-3">
                <Link href={`/releases/${row.id}`} className="text-ink hover:text-accent">
                  <span dir="ltr" className="font-mono text-xs">{row.version}</span>
                  <span className="ms-2 text-xs text-muted">{row.product_name}</span>
                </Link>
                <span className="ms-2 inline-flex"><RiskTierChip riskTier={row.risk_tier} /></span>
              </td>
              <td className="px-4 py-3 text-xs text-muted">{t(`stage.${row.stage}`)}</td>
              <td className="px-4 py-3"><ReleaseStatusChip status={row.status} /></td>
              <td className="px-4 py-3 font-mono text-xs text-muted">{row.artifacts_filed}/{row.artifacts_required}</td>
              <td className="px-4 py-3 text-xs">
                {row.stage_gap_count > 0 ? (
                  <span className="text-amber">{t('coverage.gapCount', {count: row.stage_gap_count})}</span>
                ) : (
                  <span className="text-accent">{t('coverage.ready')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
