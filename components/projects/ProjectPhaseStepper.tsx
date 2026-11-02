'use client';

import {useState} from 'react';
import {Check} from 'lucide-react';
import {useTranslations} from 'next-intl';

import Dialog from '@/components/Dialog';
import {moveProjectPhaseAction} from '@/lib/actions/projects';
import {PROJECT_PHASES, requiresOutcomeNote, type ProjectPhase} from '@/lib/projects';
import {useServerAction} from '@/lib/use-server-action';

// Phases move in either direction. Closing asks for the outcome: what was
// delivered, in a sentence someone can read later.
export default function ProjectPhaseStepper({
  projectId,
  phase,
  canManage
}: {
  projectId: string;
  phase: ProjectPhase;
  canManage: boolean;
}) {
  const t = useTranslations('projects');
  const [target, setTarget] = useState<ProjectPhase | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const index = PROJECT_PHASES.indexOf(phase);

  function move(to: ProjectPhase, withNote: string | null) {
    setError(null);
    void run(async () => {
      const result = await moveProjectPhaseAction({projectId, toPhase: to, note: withNote});
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTarget(null);
      setNote('');
    });
  }

  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap items-center gap-1.5">
        {PROJECT_PHASES.map((item, position) => {
          const here = item === phase;
          const passed = position < index;
          return (
            <li key={item}>
              <button
                type="button"
                disabled={!canManage || pending || here}
                onClick={() => {
                  if (requiresOutcomeNote(item)) setTarget(item);
                  else move(item, null);
                }}
                aria-current={here ? 'step' : undefined}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:cursor-default ${
                  here
                    ? 'border-accent/50 bg-accent/10 font-medium text-accent'
                    : passed
                      ? 'border-hairline text-muted'
                      : 'border-hairline text-faint hover:text-ink'
                }`}
              >
                {passed ? <Check className="h-3 w-3" strokeWidth={2} /> : null}
                {t(`phases.${item}`)}
              </button>
            </li>
          );
        })}
      </ol>
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}

      {target ? (
        <Dialog title={t('phase.closeTitle')} subtitle={t('phase.closeHint')} onClose={() => setTarget(null)}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (note.trim()) move(target, note.trim());
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">{t('phase.outcome')}</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
                autoFocus
                rows={4}
                maxLength={5000}
                className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent/50"
              />
            </label>
            {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTarget(null)} className="rounded-md border border-hairline px-3 py-2 text-xs text-muted hover:bg-raised hover:text-ink">
                {t('actions.cancel')}
              </button>
              <button type="submit" disabled={pending || note.trim().length === 0} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">
                {pending ? t('phase.closing') : t('phase.close')}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
