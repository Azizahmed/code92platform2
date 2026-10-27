'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import Dialog from '@/components/Dialog';
import {updateReleaseAction} from '@/lib/actions/releases';
import {RISK_TIERS, type RiskTier} from '@/lib/risk';
import {useServerAction} from '@/lib/use-server-action';

export type ReleaseEditValues = {
  version: string;
  name: string;
  goal: string;
  successCriteria: string;
  notes: string;
  targetDate: string;
  ownerId: string;
  riskTier: RiskTier;
};

// Everything about a release that is not a stage or a status. Risk tier is
// admin-only, and the database refuses the change for anyone else.
export default function ReleaseEditForm({
  releaseId,
  initial,
  members,
  isAdmin,
  onClose
}: {
  releaseId: string;
  initial: ReleaseEditValues;
  members: {userId: string; displayName: string}[];
  isAdmin: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('releases');
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const input =
    'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';
  const set = <K extends keyof ReleaseEditValues>(key: K, next: ReleaseEditValues[K]) =>
    setValue((current) => ({...current, [key]: next}));

  return (
    <Dialog title={t('edit.title')} onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void run(async () => {
            const result = await updateReleaseAction(releaseId, {
              version: value.version.trim(),
              name: value.name.trim() || null,
              goal: value.goal.trim() || null,
              successCriteria: value.successCriteria.trim() || null,
              notes: value.notes.trim() || null,
              targetDate: value.targetDate || null,
              ownerId: value.ownerId || null,
              ...(isAdmin ? {riskTier: value.riskTier} : {})
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            onClose();
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('form.version')}</span>
            <input value={value.version} onChange={(event) => set('version', event.target.value)} maxLength={60} required dir="ltr" className={input} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('form.name')}</span>
            <input value={value.name} onChange={(event) => set('name', event.target.value)} maxLength={240} className={input} />
          </label>
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs text-muted">{t('form.goal')}</span>
            <input value={value.goal} onChange={(event) => set('goal', event.target.value)} maxLength={240} className={input} />
          </label>
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs text-muted">{t('form.successCriteria')}</span>
            <textarea value={value.successCriteria} onChange={(event) => set('successCriteria', event.target.value)} rows={3} maxLength={5000} className={input} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('form.targetDate')}</span>
            <input type="date" value={value.targetDate} onChange={(event) => set('targetDate', event.target.value)} className={input} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('form.owner')}</span>
            <select value={value.ownerId} onChange={(event) => set('ownerId', event.target.value)} className={input}>
              <option value="">{t('form.noOwner')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.displayName}</option>
              ))}
            </select>
          </label>
          {isAdmin ? (
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">{t('form.riskTier')}</span>
              <select value={value.riskTier} onChange={(event) => set('riskTier', event.target.value as RiskTier)} className={input}>
                {RISK_TIERS.map((tier) => (
                  <option key={tier} value={tier}>{t(`risk.${tier}`)}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs text-muted">{t('form.notes')}</span>
            <textarea value={value.notes} onChange={(event) => set('notes', event.target.value)} rows={2} maxLength={5000} className={input} />
          </label>
        </div>
        {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-hairline px-3 py-2 text-xs text-muted hover:bg-raised hover:text-ink">{t('actions.cancel')}</button>
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">
            {pending ? t('edit.saving') : t('edit.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
