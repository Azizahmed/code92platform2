'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import {approveReleaseSpecAction, setReleaseTestResultAction} from '@/lib/actions/releases';
import {useServerAction} from '@/lib/use-server-action';

// The two decisions a stage asks for that are not a file: the owner approving the
// spec at Design, and the test result at Test.
export function SpecApproval({
  releaseId,
  approvedAt,
  selfApproved,
  canManage
}: {
  releaseId: string;
  approvedAt: string | null;
  selfApproved: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('releases');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  return (
    <div className="space-y-2 rounded-md border border-hairline p-3">
      <p className="text-xs font-medium">{t('approval.title')}</p>
      {approvedAt ? (
        <p className="text-xs text-accent">
          {t('approval.approved', {date: new Date(approvedAt).toLocaleDateString()})}
          {selfApproved ? <span className="ms-1 text-amber">· {t('approval.selfApproved')}</span> : null}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-faint">{t('approval.hint')}</p>
          {canManage ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => void run(async () => {
                const result = await approveReleaseSpecAction(releaseId);
                if (!result.ok) setError(result.error);
              })}
              className="rounded-md border border-accent/40 px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
            >
              {t('approval.approve')}
            </button>
          ) : null}
        </>
      )}
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}

export function TestResult({
  releaseId,
  result,
  findingsOpen,
  findingsClosed,
  canManage
}: {
  releaseId: string;
  result: 'pass' | 'fail' | null;
  findingsOpen: number;
  findingsClosed: number;
  canManage: boolean;
}) {
  const t = useTranslations('releases');
  const [outcome, setOutcome] = useState<'pass' | 'fail'>(result ?? 'pass');
  const [open, setOpen] = useState(findingsOpen);
  const [closed, setClosed] = useState(findingsClosed);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const input = 'w-20 rounded-md border border-hairline bg-bg px-2 py-1 text-xs outline-none focus:border-accent/50';

  return (
    <form
      className="space-y-2 rounded-md border border-hairline p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        void run(async () => {
          const response = await setReleaseTestResultAction({
            releaseId,
            result: outcome,
            findingsOpen: open,
            findingsClosed: closed
          });
          if (!response.ok) setError(response.error);
        });
      }}
    >
      <p className="text-xs font-medium">{t('test.title')}</p>
      <p className="text-[11px] text-faint">{t('test.hint')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-[11px] text-muted">{t('test.result')}</span>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as 'pass' | 'fail')} disabled={!canManage} className={input}>
            <option value="pass">{t('test.pass')}</option>
            <option value="fail">{t('test.fail')}</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] text-muted">{t('test.open')}</span>
          <input type="number" min={0} value={open} onChange={(event) => setOpen(Number(event.target.value))} disabled={!canManage} className={input} />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] text-muted">{t('test.closed')}</span>
          <input type="number" min={0} value={closed} onChange={(event) => setClosed(Number(event.target.value))} disabled={!canManage} className={input} />
        </label>
        {canManage ? (
          <button type="submit" disabled={pending} className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
            {t('test.save')}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </form>
  );
}
