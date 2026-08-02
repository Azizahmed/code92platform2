'use client';

import {useState, useTransition} from 'react';
import {CheckCircle2, Circle} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {setReleaseCheckAction} from '@/lib/actions/releases';
import type {ReleaseCheck, ReleaseStatus} from '@/lib/releases';

// The checklist a release has to clear before it may be marked released. Which
// items appear was decided by the product's risk tier when the release was
// created and is fixed from then on — see releases_seed_checks() — so a tier
// change mid-flight does not rewrite the rules a release was held to.
export default function ReleaseChecklist({
  releaseId,
  checks,
  status,
  canManage
}: {
  releaseId: string;
  checks: ReleaseCheck[];
  status: ReleaseStatus;
  canManage: boolean;
}) {
  const t = useTranslations('releases');
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Once a release is out of the door or abandoned, its checklist is history.
  const closed = status === 'released' || status === 'cancelled';
  const editable = canManage && !closed;
  const done = checks.filter((check) => check.completed_at !== null).length;

  function toggle(check: ReleaseCheck) {
    if (!editable) return;
    setError(null);
    setPendingKey(check.check_key);
    startTransition(async () => {
      const result = await setReleaseCheckAction(
        releaseId,
        check.check_key,
        check.completed_at === null
      );
      if (!result.ok) setError(result.error);
      setPendingKey(null);
    });
  }

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{t('checklist.title')}</h2>
        <span className="font-mono text-[11px] text-faint">
          {t('checklist.progress', {done, total: checks.length})}
        </span>
      </header>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {checks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-4 py-6 text-center text-xs text-muted">
          {t('checklist.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-panel">
          {checks.map((check) => {
            const complete = check.completed_at !== null;
            return (
              <li key={check.id}>
                <button
                  type="button"
                  onClick={() => toggle(check)}
                  disabled={!editable || pendingKey === check.check_key}
                  aria-pressed={complete}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-start transition-colors ${
                    editable
                      ? 'hover:bg-raised/40'
                      : 'cursor-default disabled:opacity-100'
                  }`}
                >
                  <span
                    className={`mt-0.5 shrink-0 ${
                      complete ? 'text-accent' : 'text-faint'
                    }`}
                  >
                    {complete ? (
                      <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                    ) : (
                      <Circle className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm ${
                        complete ? 'text-muted line-through' : 'text-ink'
                      }`}
                    >
                      {t(`checks.${check.check_key}.label`)}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">
                      {t(`checks.${check.check_key}.hint`)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {closed ? (
        <p className="text-[11px] text-faint">{t('checklist.closed')}</p>
      ) : !canManage ? (
        <p className="text-[11px] text-faint">{t('checklist.readOnly')}</p>
      ) : null}
    </section>
  );
}
