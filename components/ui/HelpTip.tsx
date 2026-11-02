'use client';

import {HelpCircle} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useRef, useState} from 'react';

import Popover from '@/components/ui/Popover';

export type GlossaryTerm =
  | 'businessStage'
  | 'gate'
  | 'release'
  | 'releaseStage'
  | 'evidence'
  | 'projectPhase'
  | 'taskStatus'
  | 'waitingOnMe'
  | 'follow';

// A small "?" beside a term the workflow uses, explaining it in a sentence or
// two the first time someone meets it. One glossary (messages/*/ui.json), so
// every screen explains a word the same way.
export default function HelpTip({term, className = ''}: {term: GlossaryTerm; className?: string}) {
  const t = useTranslations('ui');
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('glossary.what', {term: t(`glossary.${term}.title`)})}
        aria-expanded={open}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full align-middle text-faint transition-colors hover:text-accent aria-expanded:text-accent ${className}`}
      >
        <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={300} align="start" label={t(`glossary.${term}.title`)}>
        <div className="space-y-1.5 p-2.5 text-start">
          <p className="text-xs font-semibold text-ink">{t(`glossary.${term}.title`)}</p>
          <p className="text-xs font-normal leading-relaxed text-muted">{t(`glossary.${term}.body`)}</p>
        </div>
      </Popover>
    </>
  );
}
