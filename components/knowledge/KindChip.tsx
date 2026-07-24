import {FileText, Link2, StickyNote} from 'lucide-react';
import {useTranslations} from 'next-intl';

import type {KnowledgeKind} from '@/lib/knowledge';

const ICONS = {
  article: FileText,
  note: StickyNote,
  source: Link2
} as const;

export default function KindChip({kind}: {kind: KnowledgeKind}) {
  const t = useTranslations('knowledge');
  const Icon = ICONS[kind];

  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {t(`kinds.${kind}`)}
    </span>
  );
}
