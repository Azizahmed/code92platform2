'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import Dialog from '@/components/Dialog';
import {moveReleaseStageAction} from '@/lib/actions/releases';
import {gapLabelKey, isWaivableGap, releaseStageIndex, type ReleaseStage} from '@/lib/releases';
import {useServerAction} from '@/lib/use-server-action';

// Moves a release from one stage to the next, or back. The gaps come from
// release_stage_gaps() on the server, the same function the move checks, so the
// list is what will stop the move, not an estimate of it.
export default function ReleaseStageDialog({
  releaseId,
  version,
  from,
  to,
  gaps,
  riskTier,
  isAdmin,
  onClose
}: {
  releaseId: string;
  version: string;
  from: ReleaseStage;
  to: ReleaseStage;
  gaps: string[];
  riskTier: 'low' | 'medium' | 'high';
  isAdmin: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('releases');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const backward = releaseStageIndex(to) < releaseStageIndex(from);
  const closing = !backward;
  const hardGaps = gaps.filter((gap) => !isWaivableGap(gap));
  const waivable = gaps.filter((gap) => isWaivableGap(gap));
  // High risk: unmet checks and open work need a written waiver to ship.
  const waiverNeeded = closing && from === 'deploy' && riskTier === 'high' && waivable.length > 0;
  const valid =
    hardGaps.length === 0 &&
    (!backward || note.trim().length > 0) &&
    (!waiverNeeded || note.trim().length > 0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    setErrorDetail(null);
    void run(async () => {
      const result = await moveReleaseStageAction({
        releaseId,
        toStage: to,
        note: note.trim() || null
      });
      if (!result.ok) {
        setError(result.error);
        setErrorDetail(result.detail ?? null);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog
      title={backward ? t('stage.backTitle') : t('stage.closeTitle', {stage: t(`stage.${from}`)})}
      subtitle={`${version} · ${t(`stage.${from}`)} → ${t(`stage.${to}`)}`}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        {closing && gaps.length > 0 ? (
          <div className="space-y-2 rounded-md border border-amber/25 bg-amber/5 p-3">
            <p className="text-xs font-medium text-amber">
              {hardGaps.length > 0 ? t('stage.missingTitle') : t('stage.gapsTitle')}
            </p>
            <ul className="list-disc space-y-1 ps-4 text-xs text-muted">
              {gaps.map((gap) => (
                <li key={gap}>
                  {t(`gap.${gapLabelKey(gap)}`)}
                  {isWaivableGap(gap) ? (
                    <span className="ms-1 text-[10px] text-faint">{t('stage.waivable')}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {waiverNeeded ? <p className="text-[11px] text-faint">{t('stage.waiverHint')}</p> : null}
            {!isAdmin && riskTier === 'high' ? <p className="text-[11px] text-danger">{t('stage.adminOnly')}</p> : null}
          </div>
        ) : null}

        {closing && gaps.length === 0 ? (
          <p className="rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-xs text-accent">{t('stage.ready')}</p>
        ) : null}

        {backward || waiverNeeded ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{backward ? t('stage.reason') : t('stage.waiver')}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              required
              rows={3}
              maxLength={2000}
              className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent/50"
            />
          </label>
        ) : (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('stage.note')}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={2000}
              className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent/50"
            />
          </label>
        )}

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {t(`errors.${error}`)}
            {errorDetail ? <span className="block text-[11px] text-faint">{errorDetail}</span> : null}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
            {t('actions.cancel')}
          </button>
          <button type="submit" disabled={pending || !valid} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity disabled:opacity-40">
            {pending ? t('stage.moving') : backward ? t('stage.confirmBack') : t('stage.confirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
