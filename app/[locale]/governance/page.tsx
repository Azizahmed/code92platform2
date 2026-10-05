import {getTranslations} from 'next-intl/server';

import CoverageTable from '@/components/governance/CoverageTable';
import GateLogTable from '@/components/governance/GateLogTable';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  loadLifecycleOverview,
  loadPhaseTransitions,
  loadWaivers
} from '@/lib/lifecycle-queries';

// A product sitting in one phase this long is a signal, not a milestone.
const STUCK_AFTER_DAYS = 30;

export default async function GovernancePage() {
  const insforge = await createInsForgeServerClient();
  const [, t, overview, transitions, waivers, {data: members}, {data: products}] =
    await Promise.all([
      requireActiveMember(),
      getTranslations('lifecycle'),
      loadLifecycleOverview(),
      loadPhaseTransitions(50),
      loadWaivers(50),
      insforge.database.from('team_members').select('user_id, display_name'),
      // Transitions can reference archived products, which the overview
      // filters out — so the name map comes from the table, not the view.
      insforge.database.from('products').select('id, name')
    ]);

  const memberNames = Object.fromEntries(
    (members ?? []).map((m) => [m.user_id as string, m.display_name as string])
  );
  const productNames = Object.fromEntries(
    (products ?? []).map((p) => [p.id as string, p.name as string])
  );

  const stuck = overview.filter(
    (row) =>
      row.current_state !== 'complete' &&
      row.days_in_current_phase >= STUCK_AFTER_DAYS
  );
  const totalGaps = overview.reduce(
    (sum, row) => sum + row.missing_required_count,
    0
  );

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">{t('governance.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('governance.subtitle')}</p>
        <p className="mt-2 text-xs text-faint">
          {t('governance.totalGaps', {count: totalGaps})}
        </p>
      </header>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('governance.coverage')}</h2>
        <CoverageTable rows={overview} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('governance.stuck')}</h2>
        {stuck.length === 0 ? (
          <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-10 text-center text-sm text-muted">
            {t('governance.stuckEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-panel">
            {stuck.map((row) => (
              <li
                key={row.product_id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <Link
                  href={`/products/${row.product_id}`}
                  className="text-sm font-medium text-ink transition-colors hover:text-accent"
                >
                  {row.name}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {row.current_phase ? t(`phases.${row.current_phase}`) : '—'}
                  <span className="font-mono text-amber">
                    {t('governance.stuckDays', {
                      days: row.days_in_current_phase
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('governance.waivers')}</h2>
        <GateLogTable
          transitions={waivers}
          productNames={productNames}
          memberNames={memberNames}
          emptyMessage={t('governance.waiversEmpty')}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('governance.gateLog')}</h2>
        <GateLogTable
          transitions={transitions}
          productNames={productNames}
          memberNames={memberNames}
          emptyMessage={t('governance.gateLogEmpty')}
        />
      </div>
    </section>
  );
}
