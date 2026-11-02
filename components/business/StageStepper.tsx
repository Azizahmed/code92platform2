'use client';

import {useState} from 'react';
import {Check, ChevronLeft, ChevronRight} from 'lucide-react';
import {useTranslations} from 'next-intl';

import StageMoveDialog from '@/components/business/StageMoveDialog';
import {
  BUSINESS_STAGES,
  businessStageIndex,
  gateWaitingAt,
  type BusinessStage
} from '@/lib/business-track';

type Move = {from: BusinessStage; to: BusinessStage};

// The funnel as a row: where the product is, what is behind it, and the two gates
// between Concept and Build and between Venture and Company.
export default function StageStepper({
  productId,
  productName,
  stage,
  canManage,
  operatorName,
  gate1Outcome,
  gate2Outcome
}: {
  productId: string;
  productName: string;
  stage: BusinessStage;
  canManage: boolean;
  operatorName: string | null;
  gate1Outcome: 'go' | 'no_go' | null;
  gate2Outcome: 'go' | 'no_go' | null;
}) {
  const t = useTranslations('business');
  const [move, setMove] = useState<Move | null>(null);
  const current = businessStageIndex(stage);
  const index = BUSINESS_STAGES.indexOf(stage);
  const next = BUSINESS_STAGES[index + 1] ?? null;
  const previous = BUSINESS_STAGES[index - 1] ?? null;

  return (
    <section className="space-y-4 rounded-lg border border-hairline bg-panel p-4">
      <ol className="flex flex-wrap items-center gap-y-2">
        {BUSINESS_STAGES.map((item, position) => {
          const done = position + 1 < current;
          const here = item === stage;
          const gate = gateWaitingAt(item);
          return (
            <li key={item} className="flex items-center">
              <div
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                  here
                    ? 'border-accent/50 bg-accent/10 font-medium text-accent'
                    : done
                      ? 'border-hairline text-muted'
                      : 'border-hairline text-faint'
                }`}
                aria-current={here ? 'step' : undefined}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={2} /> : null}
                {t(`stages.${item}`)}
                {gate ? (
                  <span className="ms-1 rounded bg-amber/15 px-1 font-mono text-[9px] uppercase tracking-wider text-amber">
                    {t('gate.badge', {gate})}
                  </span>
                ) : null}
              </div>
              {position < BUSINESS_STAGES.length - 1 ? (
                <span aria-hidden className="mx-1.5 h-px w-4 bg-hairline sm:w-6" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {canManage && (previous || next) ? (
        <div className="flex flex-wrap gap-2">
          {next ? (
            <button
              type="button"
              onClick={() => setMove({from: stage, to: next})}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg"
            >
              {t('move.next', {stage: t(`stages.${next}`)})}
              <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
            </button>
          ) : null}
          {previous ? (
            <button
              type="button"
              onClick={() => setMove({from: stage, to: previous})}
              className="inline-flex items-center gap-1 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
              {t('move.back', {stage: t(`stages.${previous}`)})}
            </button>
          ) : null}
        </div>
      ) : null}

      {move ? (
        <StageMoveDialog
          productId={productId}
          productName={productName}
          from={move.from}
          to={move.to}
          operatorName={operatorName}
          gate1Outcome={gate1Outcome}
          gate2Outcome={gate2Outcome}
          onClose={() => setMove(null)}
        />
      ) : null}
    </section>
  );
}
