'use client';

import {useState} from 'react';
import {ArrowRight, ChevronLeft} from 'lucide-react';
import {useTranslations} from 'next-intl';

import ReleaseStageDialog from '@/components/releases/ReleaseStageDialog';
import {
  nextReleaseStage,
  RELEASE_STAGES,
  releaseStageIndex,
  type ReleaseStage
} from '@/lib/releases';

// The stage strip and the two moves a stage offers: on to the next, or back to
// the one before. Opening either shows what is missing first.
export default function ReleaseStagePanel({
  releaseId,
  version,
  stage,
  riskTier,
  isAdmin,
  canManage,
  gaps,
  filed
}: {
  releaseId: string;
  version: string;
  stage: ReleaseStage;
  riskTier: 'low' | 'medium' | 'high';
  isAdmin: boolean;
  canManage: boolean;
  gaps: string[];
  filed: Record<ReleaseStage, {filed: number; required: number}>;
}) {
  const t = useTranslations('releases');
  const [move, setMove] = useState<{from: ReleaseStage; to: ReleaseStage} | null>(null);
  const next = nextReleaseStage(stage);
  const index = RELEASE_STAGES.indexOf(stage);
  const previous = RELEASE_STAGES[index - 1] ?? null;
  const current = releaseStageIndex(stage);
  const blocked = riskTier === 'high' && !isAdmin;

  return (
    <section className="space-y-4">
      <ol className="grid gap-2 sm:grid-cols-6">
        {RELEASE_STAGES.map((item) => {
          const position = releaseStageIndex(item);
          const here = item === stage;
          const passed = position < current;
          const counts = filed[item];
          return (
            <li
              key={item}
              aria-current={here ? 'step' : undefined}
              className={`space-y-1 rounded-lg border p-3 ${
                here ? 'border-accent/50 bg-accent/5' : passed ? 'border-hairline bg-panel' : 'border-hairline/60 bg-panel/50'
              }`}
            >
              <p className={`text-xs font-medium ${here ? 'text-accent' : passed ? 'text-ink' : 'text-faint'}`}>
                {t(`stage.${item}`)}
              </p>
              <p className="font-mono text-[10px] text-faint">
                {t('stage.filed', {filed: counts.filed, required: counts.required})}
              </p>
              <p className="text-[10px] text-faint">
                {here ? t('stage.current') : passed ? t('stage.done') : t('stage.ahead')}
              </p>
            </li>
          );
        })}
      </ol>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {next ? (
            <button
              type="button"
              disabled={blocked}
              onClick={() => setMove({from: stage, to: next})}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40"
            >
              {t('stage.advance', {stage: t(`stage.${next}`)})}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
            </button>
          ) : null}
          {previous ? (
            <button
              type="button"
              disabled={blocked}
              onClick={() => setMove({from: stage, to: previous})}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
              {t('stage.back', {stage: t(`stage.${previous}`)})}
            </button>
          ) : null}
          {blocked ? <p className="text-[11px] text-danger">{t('stage.adminOnly')}</p> : null}
        </div>
      ) : null}

      {move ? (
        <ReleaseStageDialog
          releaseId={releaseId}
          version={version}
          from={move.from}
          to={move.to}
          gaps={move.to === nextReleaseStage(stage) ? gaps : []}
          riskTier={riskTier}
          isAdmin={isAdmin}
          onClose={() => setMove(null)}
        />
      ) : null}
    </section>
  );
}
