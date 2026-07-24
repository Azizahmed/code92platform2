import {useTranslations} from 'next-intl';

import type {KnowledgeStatus} from '@/lib/knowledge';

// Editorial statuses (draft/published) and the source review pipeline share
// one chip; colour carries the "needs attention vs settled" signal.
const TONES: Record<KnowledgeStatus, string> = {
  draft: 'border-hairline bg-raised text-faint',
  published: 'border-accent/30 bg-accent/10 text-accent',
  to_review: 'border-amber/30 bg-amber/10 text-amber',
  in_use: 'border-accent/30 bg-accent/10 text-accent',
  processed: 'border-hairline bg-raised text-muted'
};

export default function StatusChip({status}: {status: KnowledgeStatus}) {
  const t = useTranslations('knowledge');

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TONES[status]}`}
    >
      {t(`statuses.${status}`)}
    </span>
  );
}
