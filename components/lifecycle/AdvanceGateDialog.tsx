'use client';

import {TriangleAlert, X} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useTranslations} from 'next-intl';

import type {LifecyclePhase, RiskTier} from '@/lib/lifecycle';

// Shown only when completing a phase that still has gaps. Low and medium risk
// get a warning they can proceed past — the gap is recorded either way. High
// risk is blocked until an admin writes down why it is acceptable, which is
// what lands in the waiver register.
export default function AdvanceGateDialog({
  phase,
  riskTier,
  missing,
  pending,
  errorKey,
  onConfirm,
  onCancel
}: {
  phase: LifecyclePhase;
  riskTier: RiskTier;
  missing: readonly string[];
  pending: boolean;
  errorKey: string | null;
  onConfirm: (waiverReason: string | null) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('lifecycle');
  const [reason, setReason] = useState('');
  const waiverRequired = riskTier === 'high';

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel, pending]);

  const canConfirm = !pending && (!waiverRequired || reason.trim().length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(
        waiverRequired ? 'gate.blockedTitle' : 'gate.advanceTitle',
        {phase: t(`phases.${phase}`)}
      )}
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"
    >
      <button
        type="button"
        onClick={() => !pending && onCancel()}
        aria-label={t('gate.cancel')}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-lg rounded-2xl border border-hairline bg-panel p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <TriangleAlert
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                waiverRequired ? 'text-danger' : 'text-amber'
              }`}
              strokeWidth={2}
            />
            <div>
              <h2 className="text-sm font-semibold">
                {t(
                  waiverRequired ? 'gate.blockedTitle' : 'gate.advanceTitle',
                  {phase: t(`phases.${phase}`)}
                )}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {t(waiverRequired ? 'gate.blockBody' : 'gate.warnBody')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !pending && onCancel()}
            aria-label={t('gate.cancel')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        <ul className="mb-4 space-y-1.5 rounded-md border border-hairline bg-bg/50 p-3">
          {missing.map((type) => (
            <li
              key={type}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="truncate text-muted">
                {t(`artifacts.types.${type}`)}
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-danger">
                {t('gate.absent')}
              </span>
            </li>
          ))}
        </ul>

        {waiverRequired ? (
          <label className="mb-4 block space-y-1.5">
            <span className="text-xs text-muted">{t('gate.waiverLabel')}</span>
            <textarea
              rows={3}
              required
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('gate.waiverPlaceholder')}
              className="w-full resize-y rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
            />
          </label>
        ) : null}

        {errorKey ? (
          <p className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {t(`errors.${errorKey}`)}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            {t('gate.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(waiverRequired ? reason.trim() : null)}
            disabled={!canConfirm}
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 ${
              waiverRequired
                ? 'bg-danger text-bg'
                : 'bg-amber text-bg'
            }`}
          >
            {t(waiverRequired ? 'gate.confirmWithWaiver' : 'gate.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
