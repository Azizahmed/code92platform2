import {useTranslations} from 'next-intl';

import type {ReleaseStatus} from '@/lib/releases';

// Colour carries meaning here, not decoration: amber is "needs a person",
// accent is "done", danger is "went wrong". `planned` and `cancelled` are
// deliberately neutral — neither is a problem.
const STATUS_CLASS: Record<ReleaseStatus, string> = {
  planned: 'border-hairline bg-raised text-muted',
  in_progress: 'border-accent/25 bg-accent/10 text-accent',
  ready: 'border-amber/30 bg-amber/10 text-amber',
  released: 'border-accent/30 bg-accent/15 text-accent',
  rolled_back: 'border-danger/30 bg-danger/10 text-danger',
  cancelled: 'border-hairline bg-raised text-faint line-through'
};

export default function ReleaseStatusChip({
  status,
  className = ''
}: {
  status: ReleaseStatus;
  className?: string;
}) {
  const t = useTranslations('releases');

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_CLASS[status]} ${className}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}
