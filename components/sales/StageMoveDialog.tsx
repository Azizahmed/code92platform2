'use client';

import {X} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useEffect, useState} from 'react';

import {moveDealStageAction} from '@/lib/actions/sales';
import {
  OWNERSHIP_OPTIONS,
  isBackward,
  requiresOwnership,
  requiresReason,
  type DealStage,
  type DealType,
  type Ownership
} from '@/lib/sales/stages';
import {useServerAction} from '@/lib/use-server-action';

export type StageMoveRequest = {
  dealId: string;
  dealName: string;
  type: DealType;
  from: DealStage;
  to: DealStage;
};

// Asks for what the move needs (a reason for backward / lost moves, the
// code-ownership terms for a consultation win) before calling the RPC.
// Forward moves that need nothing never open this dialog.
export function needsDialog(request: Omit<StageMoveRequest, 'dealId' | 'dealName'>): boolean {
  return requiresReason(request.from, request.to) || requiresOwnership(request.type, request.to);
}

export default function StageMoveDialog({
  request,
  onClose,
  onMoved
}: {
  request: StageMoveRequest;
  onClose: () => void;
  onMoved?: () => void;
}) {
  const t = useTranslations('sales');
  const [reason, setReason] = useState('');
  const [ownership, setOwnership] = useState<Ownership | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const needReason = requiresReason(request.from, request.to);
  const needOwnership = requiresOwnership(request.type, request.to);
  const valid = (!needReason || reason.trim().length > 0) && (!needOwnership || ownership !== '');

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    void run(async () => {
      const result = await moveDealStageAction({
        dealId: request.dealId,
        toStage: request.to,
        reason: needReason ? reason : null,
        ownership: needOwnership && ownership ? ownership : null
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onMoved?.();
      onClose();
    });
  }

  const reasonHint =
    request.to === 'closed_lost'
      ? t('move.reasonLost')
      : isBackward(request.from, request.to)
        ? t('move.reasonBackward')
        : null;

  return (
    <div role="dialog" aria-modal="true" aria-label={t('move.title', {stage: t(`stages.${request.to}`)})} className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center">
      <button type="button" aria-label={t('actions.cancel')} onClick={onClose} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" />
      <form onSubmit={submit} className="relative w-full max-w-md space-y-4 rounded-xl border border-hairline bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t('move.title', {stage: t(`stages.${request.to}`)})}</h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              {request.dealName} · {t(`stages.${request.from}`)} → {t(`stages.${request.to}`)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('actions.cancel')} className="rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {needReason ? (
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
            {reasonHint ? <span className="block text-[11px] text-faint">{reasonHint}</span> : null}
          </label>
        ) : null}

        {needOwnership ? (
          <fieldset className="space-y-2">
            <legend className="text-xs text-muted">{t('move.ownership')}</legend>
            {OWNERSHIP_OPTIONS.map((option) => (
              <label key={option} className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${ownership === option ? 'border-accent/40 bg-accent/5' : 'border-hairline hover:bg-raised/50'}`}>
                <input
                  type="radio"
                  name="ownership"
                  value={option}
                  checked={ownership === option}
                  onChange={() => setOwnership(option)}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  <span className="block text-sm text-ink">{t(`ownership.${option}`)}</span>
                  <span className="block text-[11px] text-faint">{t(`ownershipHint.${option}`)}</span>
                </span>
              </label>
            ))}
            <p className="text-[11px] text-faint">{t('move.engagementNote')}</p>
          </fieldset>
        ) : null}

        {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
            {t('actions.cancel')}
          </button>
          <button
            type="submit"
            disabled={pending || !valid}
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-opacity disabled:opacity-40 ${
              request.to === 'closed_lost' ? 'bg-danger text-bg' : 'bg-accent text-bg'
            }`}
          >
            {pending ? t('move.moving') : t('move.confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}
