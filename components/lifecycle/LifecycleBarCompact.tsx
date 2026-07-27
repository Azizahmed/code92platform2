import {useTranslations} from 'next-intl';

import {
  LIFECYCLE_PHASES,
  phaseIndex,
  type LifecyclePhase,
  type LifecycleState
} from '@/lib/lifecycle';

const SEGMENT_STYLES: Record<'done' | 'current' | 'blocked' | 'todo', string> = {
  done: 'bg-accent',
  current: 'bg-accent/50',
  blocked: 'bg-danger',
  todo: 'bg-hairline'
};

// Six-segment strip for dashboard cards and the products table. Derived from
// the product_overview columns, so it costs no extra query.
//
// `completeCount` is a count, not a position: a product can have four phases
// complete while sitting in the second. The strip fills the first N segments
// and marks the current phase separately, which is the honest reading.
export default function LifecycleBarCompact({
  phase,
  state,
  completeCount
}: {
  phase: LifecyclePhase | null;
  state: LifecycleState | null;
  completeCount: number;
}) {
  const t = useTranslations('lifecycle');
  const currentIndex = phase ? phaseIndex(phase) - 1 : -1;

  return (
    <div
      className="flex items-center gap-1"
      title={
        phase
          ? `${t(`phases.${phase}`)} — ${t(`states.${state ?? 'not_started'}`)}`
          : undefined
      }
    >
      {LIFECYCLE_PHASES.map((entry, index) => {
        const kind =
          index === currentIndex && state === 'blocked'
            ? 'blocked'
            : index < completeCount
              ? 'done'
              : index === currentIndex
                ? 'current'
                : 'todo';

        return (
          <span
            key={entry}
            aria-hidden
            className={`h-1 flex-1 rounded-full ${SEGMENT_STYLES[kind]}`}
          />
        );
      })}
      <span className="sr-only">
        {phase
          ? `${t(`phases.${phase}`)} — ${t(`states.${state ?? 'not_started'}`)}`
          : t('states.not_started')}
      </span>
    </div>
  );
}
