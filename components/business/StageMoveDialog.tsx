'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import Dialog from '@/components/Dialog';
import {moveBusinessStageAction} from '@/lib/actions/business';
import {
  businessStageIndex,
  movementBlockers,
  type BusinessStage
} from '@/lib/business-track';
import {useServerAction} from '@/lib/use-server-action';

// Shows what a move still needs before it is submitted, from the same rules the
// database enforces. The database has the last word: a refusal comes back as an
// error key and is shown in place.
export default function StageMoveDialog({
  productId,
  productName,
  from,
  to,
  operatorName,
  gate1Outcome,
  gate2Outcome,
  onClose
}: {
  productId: string;
  productName: string;
  from: BusinessStage;
  to: BusinessStage;
  operatorName: string | null;
  gate1Outcome: 'go' | 'no_go' | null;
  gate2Outcome: 'go' | 'no_go' | null;
  onClose: () => void;
}) {
  const t = useTranslations('business');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const backward = businessStageIndex(to) < businessStageIndex(from);
  const blockers = movementBlockers({
    from,
    to,
    operatorName,
    gate1Outcome,
    gate2Outcome
  });
  const valid = blockers.length === 0 && (!backward || reason.trim().length > 0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    void run(async () => {
      const result = await moveBusinessStageAction({
        productId,
        toStage: to,
        reason: backward ? reason : null
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog
      title={backward ? t('move.backTitle') : t('move.title', {stage: t(`stages.${to}`)})}
      subtitle={`${productName} · ${t(`stages.${from}`)} → ${t(`stages.${to}`)}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {blockers.length > 0 ? (
          <div className="space-y-1.5 rounded-md border border-amber/25 bg-amber/5 p-3">
            <p className="text-xs font-medium text-amber">{t('move.blockedTitle')}</p>
            <ul className="list-disc space-y-1 ps-4 text-xs text-muted">
              {blockers.map((blocker) => (
                <li key={blocker}>{t(`move.blockers.${blocker}`)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {backward ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('move.reason')}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              autoFocus
              rows={3}
              maxLength={1000}
              className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
            />
            <span className="block text-[11px] text-faint">{t('move.reasonHint')}</span>
          </label>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {t(`errors.${error}`)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity disabled:opacity-40"
          >
            {pending ? t('move.moving') : backward ? t('move.confirmBack') : t('move.confirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
