'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import {exitReleaseAction} from '@/lib/actions/releases';
import {exitTargets, type ReleaseStatus} from '@/lib/releases';
import {useServerAction} from '@/lib/use-server-action';

// The exits from the loop. Cancelling, rolling a shipped release back, and the
// two ways back in are the only status changes a person makes by hand; forward
// movement is the stage strip above.
export default function ReleaseStatusControl({
  releaseId,
  status,
  canManage
}: {
  releaseId: string;
  status: ReleaseStatus;
  canManage: boolean;
}) {
  const t = useTranslations('releases');
  const [target, setTarget] = useState<ReleaseStatus | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const options = exitTargets(status);

  if (!canManage || options.length === 0) return null;

  const needsReason = target === 'cancelled' || target === 'rolled_back';

  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
      <h2 className="text-sm font-medium">{t('exit.title')}</h2>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setTarget(target === option ? null : option);
            }}
            className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
              target === option
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-hairline text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            {t(`exit.to.${option}`)}
          </button>
        ))}
      </div>

      {target ? (
        <form
          className="space-y-3 rounded-md border border-hairline bg-bg/40 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void run(async () => {
              const result = await exitReleaseAction({
                releaseId,
                status: target,
                reason: needsReason ? reason : null
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setTarget(null);
              setReason('');
            });
          }}
        >
          <p className="text-xs text-muted">{t(`exit.confirm.${target}`)}</p>
          {needsReason ? (
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              rows={2}
              maxLength={2000}
              className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50"
            />
          ) : null}
          {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTarget(null)} className="rounded-md border border-hairline px-3 py-2 text-xs text-muted hover:bg-raised hover:text-ink">
              {t('actions.cancel')}
            </button>
            <button type="submit" disabled={pending || (needsReason && reason.trim().length === 0)} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">
              {t(`exit.apply.${target}`)}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
