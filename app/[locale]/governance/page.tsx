import {getTranslations} from 'next-intl/server';

import HelpTip from '@/components/ui/HelpTip';
import ArtifactPolicyTable, {type PolicyRow} from '@/components/governance/ArtifactPolicyTable';
import CoverageTable from '@/components/governance/CoverageTable';
import GateLogTable, {type GateLogEntry} from '@/components/governance/GateLogTable';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {ReleaseOverview} from '@/lib/releases';

// Governance reads the same records the moves write: the gate log, the evidence
// each live release still needs, and the waivers somebody had to write down.
export default async function GovernancePage({
  params
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  const {member} = await requireActiveMember();
  const t = await getTranslations('governance');
  const insforge = await createInsForgeServerClient();
  const isAdmin = member.role === 'admin';

  const [{data: releases}, {data: log}, {data: waivers}, {data: waiting}, {data: policy}] = await Promise.all([
    insforge.database
      .from('release_overview')
      .select('*')
      .in('status', ['planned', 'in_progress', 'ready', 'released'])
      .order('target_date', {ascending: true, nullsFirst: false}),
    insforge.database
      .from('governance_gate_log')
      .select('*')
      .order('occurred_at', {ascending: false})
      .limit(150),
    insforge.database
      .from('governance_gate_log')
      .select('*')
      .not('waiver_reason', 'is', null)
      .order('occurred_at', {ascending: false})
      .limit(50),
    insforge.database.rpc('dashboard_attention'),
    isAdmin
      ? insforge.database.from('release_artifact_policy').select('risk_tier, kind, artifact_key, is_required')
      : Promise.resolve({data: [] as Record<string, unknown>[]})
  ]);

  const releaseRows = (releases ?? []) as unknown as ReleaseOverview[];
  const gapCount = releaseRows.filter((row) => row.stage_gap_count > 0).length;
  const gateWaits = ((waiting ?? []) as {kind: string; title: string; record_id: string; detail: string | null}[])
    .filter((row) => row.kind === 'gate_pending');

  return (
    <section className="space-y-8">
      <header>
        <h1 className="flex items-center gap-1.5 text-xl font-semibold">{t('title')}<HelpTip term="evidence" /></h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        <p className="mt-2 text-xs text-faint">{t('gapsSummary', {count: gapCount})}</p>
      </header>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('waitingGates.title')}</h2>
        {gateWaits.length === 0 ? (
          <p className="text-xs text-faint">{t('waitingGates.empty')}</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-panel">
            {gateWaits.map((row) => (
              <li key={row.record_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <Link href={`/products/${row.record_id}?tab=business`} className="text-sm font-medium text-ink hover:text-accent">
                  {row.title}
                </Link>
                <span className="font-mono text-xs text-amber">{t('waitingGates.gate', {gate: row.detail ?? ''})}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('coverage.title')}</h2>
        <CoverageTable rows={releaseRows} />
      </div>

      {isAdmin ? (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">{t('policy.title')}</h2>
          <ArtifactPolicyTable rows={(policy ?? []) as unknown as PolicyRow[]} />
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('waivers.title')}</h2>
        <GateLogTable
          entries={(waivers ?? []) as unknown as GateLogEntry[]}
          emptyMessage={t('waivers.empty')}
          locale={locale}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('log.title')}</h2>
        <GateLogTable
          entries={(log ?? []) as unknown as GateLogEntry[]}
          emptyMessage={t('log.empty')}
          locale={locale}
        />
      </div>
    </section>
  );
}
