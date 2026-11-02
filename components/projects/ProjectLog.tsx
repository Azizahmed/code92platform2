'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import {addProjectNoteAction} from '@/lib/actions/projects';
import {useServerAction} from '@/lib/use-server-action';

export type ProjectLogEntry = {
  id: string;
  kind: 'created' | 'phase_change' | 'field_change' | 'note' | 'idea_captured';
  from_phase: string | null;
  to_phase: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  actor_name: string | null;
  created_at: string;
};

// The project's record: what happened, who did it, and the notes people left.
export default function ProjectLog({
  projectId,
  entries,
  canWrite
}: {
  projectId: string;
  entries: ProjectLogEntry[];
  canWrite: boolean;
}) {
  const t = useTranslations('projects');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  return (
    <section className="space-y-4">
      {canWrite ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = text.trim();
            if (!body) return;
            setError(null);
            void run(async () => {
              const result = await addProjectNoteAction(projectId, body);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setText('');
            });
          }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={5000}
            placeholder={t('log.placeholder')}
            aria-label={t('log.add')}
            className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
          <div className="flex items-center justify-between gap-2">
            {error ? <span role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</span> : <span />}
            <button type="submit" disabled={pending || text.trim().length === 0} className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
              {t('log.add')}
            </button>
          </div>
        </form>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-xs text-faint">{t('log.empty')}</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-0.5 border-s-2 border-hairline ps-3 text-xs">
              <p className="text-ink">
                <span className="font-medium">{entry.actor_name ?? t('log.someone')}</span>{' '}
                <span className="text-muted">{describe(entry, t)}</span>
              </p>
              {entry.body ? <p className="whitespace-pre-line text-muted">{entry.body}</p> : null}
              <p className="text-[10px] text-faint">
                <RelativeTime date={entry.created_at} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function describe(entry: ProjectLogEntry, t: (key: string, values?: Record<string, string>) => string): string {
  switch (entry.kind) {
    case 'created':
      return t('log.created');
    case 'phase_change':
      return t('log.phaseChange', {
        from: t(`phases.${entry.from_phase ?? 'kickoff'}`),
        to: t(`phases.${entry.to_phase ?? 'kickoff'}`)
      });
    case 'field_change':
      return t('log.fieldChange', {field: String(entry.meta?.field ?? '')});
    case 'idea_captured':
      return t('log.ideaCaptured');
    default:
      return t('log.noted');
  }
}
