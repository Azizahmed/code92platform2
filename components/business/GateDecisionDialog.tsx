'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import Dialog from '@/components/Dialog';
import {recordGateDecisionAction} from '@/lib/actions/business';
import type {GateNumber} from '@/lib/business-track';
import {useServerAction} from '@/lib/use-server-action';

// A founder's decision on a gate. Gate 1 is go or no-go with a note; a Gate 2 go
// also needs the PMF criteria used and the evidence for them.
export default function GateDecisionDialog({
  productId,
  productName,
  gate,
  onClose
}: {
  productId: string;
  productName: string;
  gate: GateNumber;
  onClose: () => void;
}) {
  const t = useTranslations('business');
  const [decision, setDecision] = useState<'go' | 'no_go'>('go');
  const [note, setNote] = useState('');
  const [criteria, setCriteria] = useState('');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const needsPmf = gate === 2 && decision === 'go';
  const valid =
    note.trim().length > 0 &&
    (!needsPmf || (criteria.trim().length > 0 && evidence.trim().length > 0));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    void run(async () => {
      const result = await recordGateDecisionAction({
        productId,
        gate,
        decision,
        note,
        pmfCriteria: needsPmf ? criteria : null,
        evidence: needsPmf ? evidence : null
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
      title={t('gate.recordTitle', {gate})}
      subtitle={`${productName} · ${t(`gate.name.${gate}`)}`}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-xs text-muted">{t('gate.decisionLabel')}</legend>
          {(['go', 'no_go'] as const).map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                decision === option ? 'border-accent/40 bg-accent/5' : 'border-hairline hover:bg-raised/50'
              }`}
            >
              <input
                type="radio"
                name="decision"
                value={option}
                checked={decision === option}
                onChange={() => setDecision(option)}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className="block text-sm text-ink">{t(`gate.decision.${option}`)}</span>
                <span className="block text-[11px] text-faint">{t(`gate.decisionHint.${option}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('gate.note')}</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required
            rows={3}
            maxLength={2000}
            placeholder={t('gate.notePlaceholder')}
            className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
        </label>

        {needsPmf ? (
          <>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">{t('gate.pmfCriteria')}</span>
              <textarea
                value={criteria}
                onChange={(event) => setCriteria(event.target.value)}
                required
                rows={3}
                maxLength={5000}
                className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent/50"
              />
              <span className="block text-[11px] text-faint">{t('gate.pmfCriteriaHint')}</span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">{t('gate.evidence')}</span>
              <textarea
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                required
                rows={3}
                maxLength={5000}
                className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent/50"
              />
              <span className="block text-[11px] text-faint">{t('gate.evidenceHint')}</span>
            </label>
          </>
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
            {pending ? t('gate.saving') : t('gate.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
