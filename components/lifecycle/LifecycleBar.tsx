'use client';

import {Check, TriangleAlert} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {
  LIFECYCLE_PHASES,
  type LifecyclePhase,
  type LifecycleState
} from '@/lib/lifecycle';

export type PhaseSummary = {
  phase: LifecyclePhase;
  state: LifecycleState;
  missingCount: number;
};

const DOT_STYLES: Record<LifecycleState, string> = {
  complete: 'border-accent bg-accent text-bg',
  in_progress: 'border-accent bg-accent/15 text-accent',
  blocked: 'border-danger bg-danger/15 text-danger',
  not_started: 'border-hairline bg-raised text-faint'
};

const LABEL_STYLES: Record<LifecycleState, string> = {
  complete: 'text-muted',
  in_progress: 'text-ink font-medium',
  blocked: 'text-danger font-medium',
  not_started: 'text-faint'
};

// The status bar. Laid out as a 6-column grid with the connector drawn from
// each dot's own half-segments, using logical `start`/`end` insets — so the
// whole thing mirrors correctly under dir="rtl" without a single flip rule.
export default function LifecycleBar({
  phases,
  selected,
  onSelect
}: {
  phases: PhaseSummary[];
  selected: LifecyclePhase;
  onSelect: (phase: LifecyclePhase) => void;
}) {
  const t = useTranslations('lifecycle');

  const byPhase = new Map(phases.map((entry) => [entry.phase, entry]));
  const ordered = LIFECYCLE_PHASES.map(
    (phase) =>
      byPhase.get(phase) ?? {phase, state: 'not_started' as const, missingCount: 0}
  );

  return (
    <ol className="grid grid-cols-6 gap-x-1">
      {ordered.map((entry, index) => {
        const isSelected = entry.phase === selected;
        const previousComplete =
          index > 0 && ordered[index - 1].state === 'complete';

        return (
          <li key={entry.phase} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(entry.phase)}
              aria-current={isSelected ? 'step' : undefined}
              aria-label={`${t(`phases.${entry.phase}`)} — ${t(`states.${entry.state}`)}`}
              className="group flex w-full flex-col items-center gap-1.5 rounded-md py-1 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent/60"
            >
              <span className="relative flex w-full items-center justify-center">
                {index > 0 ? (
                  <span
                    aria-hidden
                    className={`absolute start-0 end-1/2 h-px ${
                      previousComplete ? 'bg-accent/60' : 'bg-hairline'
                    }`}
                  />
                ) : null}
                {index < ordered.length - 1 ? (
                  <span
                    aria-hidden
                    className={`absolute start-1/2 end-0 h-px ${
                      entry.state === 'complete' ? 'bg-accent/60' : 'bg-hairline'
                    }`}
                  />
                ) : null}

                <span
                  className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[11px] transition-transform group-hover:scale-105 ${
                    DOT_STYLES[entry.state]
                  } ${isSelected ? 'ring-2 ring-accent/40 ring-offset-2 ring-offset-panel' : ''}`}
                >
                  {entry.state === 'complete' ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  ) : entry.state === 'blocked' ? (
                    <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    index + 1
                  )}
                </span>

                {entry.missingCount > 0 ? (
                  <span
                    aria-hidden
                    title={t('gate.missing', {count: entry.missingCount})}
                    className="absolute top-0 z-20 flex h-4 min-w-4 -translate-y-1 items-center justify-center rounded-full bg-amber px-1 font-mono text-[9px] font-semibold text-bg start-1/2 ms-2"
                  >
                    {entry.missingCount}
                  </span>
                ) : null}
              </span>

              <span
                className={`w-full truncate text-center text-[10px] leading-tight sm:text-[11px] ${LABEL_STYLES[entry.state]}`}
              >
                {t(`phases.${entry.phase}`)}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
