'use client';

import {useState} from 'react';
import {ChevronDown, ClipboardCheck} from 'lucide-react';
import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';

// The button under a completed task: press it to read what was done.
//
// Collapsed by default. A finished task's value in a list is that it is out of
// the way; the note is there for the person who comes looking, not for everyone
// scrolling past.
export default function TaskCompletionNote({
  note,
  completedBy,
  completedAt
}: {
  note: string | null;
  completedBy: string | null;
  completedAt: string | null;
}) {
  const t = useTranslations('tasks');
  const [open, setOpen] = useState(false);

  // Nothing was recorded — for tasks completed before notes existed, or when
  // the person skipped. Say so plainly rather than showing an empty panel.
  const hasNote = Boolean(note && note.trim());

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
          hasNote
            ? 'border-accent/25 bg-accent/[0.07] text-accent hover:bg-accent/10'
            : 'border-hairline text-faint hover:bg-raised hover:text-muted'
        }`}
      >
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        {hasNote ? t('completion.viewNote') : t('completion.noNote')}
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          strokeWidth={1.75}
        />
      </button>

      {open ? (
        <div className="mt-2 rounded-md border border-hairline bg-bg/50 p-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-widest text-faint">
            <span>
              {completedBy
                ? t('completion.by', {name: completedBy})
                : t('completion.byUnknown')}
            </span>
            {completedAt ? <RelativeTime date={completedAt} /> : null}
          </div>
          <p
            dir="auto"
            className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted"
          >
            {hasNote ? note : t('completion.noNoteBody')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
