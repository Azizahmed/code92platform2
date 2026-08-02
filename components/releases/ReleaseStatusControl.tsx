'use client';

import {useState, useTransition} from 'react';
import {TriangleAlert} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {advanceReleaseStatusAction} from '@/lib/actions/releases';
import type {RiskTier} from '@/lib/lifecycle';
import {
  nextStatuses,
  OPEN_TASKS_GAP,
  requiresWaiver,
  type ReleaseCheck,
  type ReleaseStatus
} from '@/lib/releases';

// Moving a release along. The gate is enforced in advance_release_status();
// everything here exists so a person can see what is missing BEFORE they press
// the button, rather than discovering it in an error toast.
export default function ReleaseStatusControl({
  releaseId,
  status,
  riskTier,
  checks,
  openTaskCount,
  canManage
}: {
  releaseId: string;
  status: ReleaseStatus;
  riskTier: RiskTier;
  checks: ReleaseCheck[];
  openTaskCount: number;
  canManage: boolean;
}) {
  const t = useTranslations('releases');
  const [target, setTarget] = useState<ReleaseStatus | null>(null);
  const [waiver, setWaiver] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Exactly what the database will compute, including the 'open_tasks'
  // pseudo-entry it appends. Mirroring it here is the only way the waiver box
  // can appear at the right moment.
  const missing = [
    ...checks
      .filter((check) => check.is_required && check.completed_at === null)
      .map((check) => check.check_key),
    ...(openTaskCount > 0 ? [OPEN_TASKS_GAP] : [])
  ];

  const options = nextStatuses(status);
  if (!canManage || options.length === 0) return null;

  const waiverNeeded = target ? requiresWaiver(riskTier, target, missing) : false;
  const showGaps = target === 'released' && missing.length > 0;

  function submit(next: ReleaseStatus) {
    setError(null);
    startTransition(async () => {
      const result = await advanceReleaseStatusAction(
        releaseId,
        next,
        waiverNeeded ? waiver : null
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTarget(null);
      setWaiver('');
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
      <h2 className="text-sm font-medium">{t('advance.title')}</h2>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = target === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => {
                setError(null);
                // Every move except releasing is one click. Releasing is the
                // one that needs a look at what is unfinished first.
                if (option === 'released' || option === 'rolled_back') {
                  setTarget(selected ? null : option);
                } else {
                  setTarget(null);
                  submit(option);
                }
              }}
              disabled={pending}
              className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                selected
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-hairline text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {t(`advance.to.${option}`)}
            </button>
          );
        })}
      </div>

      {target ? (
        <div className="space-y-3 rounded-md border border-hairline bg-bg/40 p-3">
          <p className="text-xs text-muted">{t(`advance.confirm.${target}`)}</p>

          {showGaps ? (
            <div className="space-y-1.5 rounded-md border border-amber/25 bg-amber/5 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber">
                <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('advance.gapsTitle')}
              </div>
              <ul className="ms-5 list-disc space-y-0.5 text-[11px] text-muted">
                {missing.map((key) => (
                  <li key={key}>
                    {key === OPEN_TASKS_GAP
                      ? t('advance.openTasks', {count: openTaskCount})
                      : t(`checks.${key}.label`)}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-faint">
                {waiverNeeded
                  ? t('advance.waiverRequired')
                  : t('advance.gapsRecorded')}
              </p>
            </div>
          ) : null}

          {waiverNeeded ? (
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">{t('advance.waiver')}</span>
              <textarea
                required
                rows={3}
                maxLength={2000}
                value={waiver}
                onChange={(event) => setWaiver(event.target.value)}
                placeholder={t('advance.waiverPlaceholder')}
                className="w-full resize-y rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
              />
            </label>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => submit(target)}
              disabled={pending || (waiverNeeded && waiver.trim().length === 0)}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? t('advance.working') : t(`advance.to.${target}`)}
            </button>
            <button
              type="button"
              onClick={() => {
                setTarget(null);
                setWaiver('');
              }}
              className="rounded-md border border-hairline px-3.5 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              {t('form.cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
