'use client';

import {Check, Trophy, XCircle} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useState} from 'react';

import StageMoveDialog, {needsDialog, type StageMoveRequest} from '@/components/sales/StageMoveDialog';
import {moveDealStageAction} from '@/lib/actions/sales';
import {OPEN_STAGES, isClosed, stageRank, type DealStage, type DealType} from '@/lib/sales/stages';
import {useServerAction} from '@/lib/use-server-action';

// Stage controls on the deal page: the open stages as a stepper, plus Won /
// Lost. Moves that need a reason or ownership open the dialog first.
export default function StageStepper({
  dealId,
  dealName,
  type,
  stage
}: {
  dealId: string;
  dealName: string;
  type: DealType;
  stage: DealStage;
}) {
  const t = useTranslations('sales');
  const [dialog, setDialog] = useState<StageMoveRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  function move(to: DealStage) {
    if (to === stage) return;
    setError(null);
    const request = {dealId, dealName, type, from: stage, to};
    if (needsDialog(request)) {
      setDialog(request);
      return;
    }
    void run(async () => {
      const result = await moveDealStageAction({dealId, toStage: to, reason: null, ownership: null});
      if (!result.ok) setError(result.error);
    });
  }

  const closed = isClosed(stage);
  const rank = stageRank(stage);

  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-5 gap-1">
        {OPEN_STAGES.map((value) => {
          const current = value === stage;
          const passed = !closed && stageRank(value) < rank;
          return (
            <li key={value}>
              <button
                type="button"
                disabled={pending || current}
                onClick={() => move(value)}
                aria-current={current ? 'step' : undefined}
                title={t(`stages.${value}`)}
                className={`flex w-full flex-col items-center gap-1 rounded-md border px-1 py-2 text-[10px] transition-colors disabled:cursor-default ${
                  current
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : passed
                      ? 'border-hairline bg-raised text-muted hover:text-ink'
                      : 'border-hairline text-faint hover:bg-raised hover:text-ink'
                }`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${current ? 'border-accent bg-accent text-bg' : passed ? 'border-muted bg-muted text-bg' : 'border-faint'}`}>
                  {passed ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                </span>
                <span className="w-full truncate text-center">{t(`stages.${value}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pending || stage === 'closed_won'}
          onClick={() => move('closed_won')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-default ${
            stage === 'closed_won' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-hairline text-muted hover:border-accent/40 hover:text-accent'
          }`}
        >
          <Trophy className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t('stages.closed_won')}
        </button>
        <button
          type="button"
          disabled={pending || stage === 'closed_lost'}
          onClick={() => move('closed_lost')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-default ${
            stage === 'closed_lost' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-hairline text-muted hover:border-danger/40 hover:text-danger'
          }`}
        >
          <XCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t('stages.closed_lost')}
        </button>
      </div>

      {closed ? <p className="text-[11px] text-faint">{t('stageHelp.reopen')}</p> : null}
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
      {dialog ? <StageMoveDialog request={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
