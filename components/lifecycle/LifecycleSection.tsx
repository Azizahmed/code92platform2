'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import LifecycleBar, {
  type PhaseSummary
} from '@/components/lifecycle/LifecycleBar';
import PhasePanel from '@/components/lifecycle/PhasePanel';
import type {KnowledgeOption} from '@/components/lifecycle/PhaseArtifactForm';
import RiskTierChip from '@/components/lifecycle/RiskTierChip';
import {
  setProductRiskTierAction,
  type LifecyclePhaseRow,
  type PhaseArtifact
} from '@/lib/actions/lifecycle';
import {
  RISK_TIERS,
  missingArtifacts,
  type LifecyclePhase,
  type RiskTier
} from '@/lib/lifecycle';

// Which phase to open first: the one needing attention. A blocked phase
// outranks an in-progress one; otherwise the earliest unfinished phase. Matches
// the ordering product_lifecycle_overview uses, so the bar and /governance
// never disagree about "where is this product".
function defaultPhase(rows: LifecyclePhaseRow[]): LifecyclePhase {
  const rank = {blocked: 0, in_progress: 1, not_started: 2, complete: 3};
  const sorted = [...rows].sort((a, b) => rank[a.state] - rank[b.state]);
  return sorted[0]?.phase ?? 'ideation';
}

export default function LifecycleSection({
  productId,
  riskTier,
  isAdmin,
  canEdit,
  phases,
  artifacts,
  knowledgeOptions,
  memberNames,
  repo,
  repoBranch
}: {
  productId: string;
  riskTier: RiskTier;
  isAdmin: boolean;
  canEdit: boolean;
  phases: LifecyclePhaseRow[];
  artifacts: Record<string, PhaseArtifact[]>;
  knowledgeOptions: KnowledgeOption[];
  memberNames: Record<string, string>;
  repo: string | null;
  repoBranch: string | null;
}) {
  const t = useTranslations('lifecycle');
  const [selected, setSelected] = useState<LifecyclePhase>(() =>
    defaultPhase(phases)
  );
  const [tierError, setTierError] = useState<string | null>(null);
  const [tierPending, startTierTransition] = useTransition();

  const summaries: PhaseSummary[] = phases.map((row) => ({
    phase: row.phase,
    state: row.state,
    missingCount: missingArtifacts(
      row.phase,
      riskTier,
      (artifacts[row.id] ?? []).map((artifact) => artifact.artifact_type)
    ).length
  }));

  const selectedRow =
    phases.find((row) => row.phase === selected) ?? phases[0] ?? null;

  function handleTierChange(next: RiskTier) {
    setTierError(null);
    startTierTransition(async () => {
      const result = await setProductRiskTierAction(productId, next);
      if (!result.ok) setTierError(result.error);
    });
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-hairline bg-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">{t('title')}</h2>
            <p className="mt-0.5 text-xs text-muted">{t('subtitle')}</p>
          </div>

          {isAdmin ? (
            <label className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-faint">
                {t('risk.label')}
              </span>
              <select
                value={riskTier}
                disabled={tierPending}
                onChange={(event) =>
                  handleTierChange(event.target.value as RiskTier)
                }
                className="rounded-md border border-hairline bg-bg px-2 py-1 text-xs outline-none transition-colors focus:border-accent/50 disabled:opacity-50"
              >
                {RISK_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {t(`risk.${tier}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <RiskTierChip riskTier={riskTier} />
          )}
        </div>

        <LifecycleBar
          phases={summaries}
          selected={selected}
          onSelect={setSelected}
        />

        {tierError ? (
          <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {t(`errors.${tierError}`)}
          </p>
        ) : null}
      </div>

      {selectedRow ? (
        <PhasePanel
          key={selectedRow.id}
          row={selectedRow}
          artifacts={artifacts[selectedRow.id] ?? []}
          riskTier={riskTier}
          canEdit={canEdit}
          knowledgeOptions={knowledgeOptions}
          memberNames={memberNames}
          repo={repo}
          repoBranch={repoBranch}
        />
      ) : null}
    </section>
  );
}
