'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import {
  updateProductBusinessAction,
  type BusinessDetailsInput
} from '@/lib/actions/business';
import {ORIGINATIONS, OWNERSHIPS} from '@/lib/business-track';
import {useServerAction} from '@/lib/use-server-action';

export type PersonOption = {id: string; name: string};

export type BusinessDetails = {
  origination: string | null;
  ownership: string | null;
  code92EquityPct: number | null;
  operatorName: string | null;
  operatorUserId: string | null;
  operatorContactId: string | null;
  businessOwnerId: string | null;
  sector: string | null;
};

// Origination, ownership, the operator and the business owner. Written through
// one RPC, which checks the caller may manage the business track at all.
export default function BusinessDetailsForm({
  productId,
  initial,
  members,
  contacts,
  canEdit
}: {
  productId: string;
  initial: BusinessDetails;
  members: PersonOption[];
  contacts: PersonOption[];
  canEdit: boolean;
}) {
  const t = useTranslations('business');
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, run] = useServerAction();

  const set = <K extends keyof BusinessDetails>(key: K, next: BusinessDetails[K]) => {
    setSaved(false);
    setValue((current) => ({...current, [key]: next}));
  };

  const input =
    'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50 disabled:opacity-60';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payload: BusinessDetailsInput = {
      origination: (value.origination as BusinessDetailsInput['origination']) ?? null,
      ownership: (value.ownership as BusinessDetailsInput['ownership']) ?? null,
      code92EquityPct: value.ownership === 'co_owned' ? value.code92EquityPct : null,
      operatorName: value.operatorName?.trim() || null,
      operatorUserId: value.operatorUserId || null,
      operatorContactId: value.operatorContactId || null,
      businessOwnerId: value.businessOwnerId || null,
      sector: value.sector?.trim() || null
    };
    void run(async () => {
      const result = await updateProductBusinessAction(productId, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('details.origination')}</span>
          <select
            value={value.origination ?? ''}
            disabled={!canEdit}
            onChange={(event) => set('origination', event.target.value || null)}
            className={input}
          >
            <option value="">{t('details.notSet')}</option>
            {ORIGINATIONS.map((option) => (
              <option key={option} value={option}>{t(`details.originations.${option}`)}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('details.ownership')}</span>
          <select
            value={value.ownership ?? ''}
            disabled={!canEdit}
            onChange={(event) => set('ownership', event.target.value || null)}
            className={input}
          >
            <option value="">{t('details.notSet')}</option>
            {OWNERSHIPS.map((option) => (
              <option key={option} value={option}>{t(`details.ownerships.${option}`)}</option>
            ))}
          </select>
        </label>

        {value.ownership === 'co_owned' ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('details.equity')}</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              disabled={!canEdit}
              value={value.code92EquityPct ?? ''}
              onChange={(event) =>
                set('code92EquityPct', event.target.value === '' ? null : Number(event.target.value))
              }
              className={input}
            />
            <span className="block text-[11px] text-faint">{t('details.equityHint')}</span>
          </label>
        ) : null}

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('details.sector')}</span>
          <input
            value={value.sector ?? ''}
            maxLength={100}
            disabled={!canEdit}
            onChange={(event) => set('sector', event.target.value)}
            className={input}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('details.operatorName')}</span>
          <input
            value={value.operatorName ?? ''}
            maxLength={200}
            disabled={!canEdit}
            onChange={(event) => set('operatorName', event.target.value)}
            placeholder={t('details.operatorNamePlaceholder')}
            className={input}
          />
          <span className="block text-[11px] text-faint">{t('details.operatorHint')}</span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('details.operatorUser')}</span>
          <select
            value={value.operatorUserId ?? ''}
            disabled={!canEdit}
            onChange={(event) => set('operatorUserId', event.target.value || null)}
            className={input}
          >
            <option value="">{t('details.notSet')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('details.operatorContact')}</span>
          <select
            value={value.operatorContactId ?? ''}
            disabled={!canEdit}
            onChange={(event) => set('operatorContactId', event.target.value || null)}
            className={input}
          >
            <option value="">{t('details.notSet')}</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>{contact.name}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('details.businessOwner')}</span>
          <select
            value={value.businessOwnerId ?? ''}
            disabled={!canEdit}
            onChange={(event) => set('businessOwnerId', event.target.value || null)}
            className={input}
          >
            <option value="">{t('details.notSet')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        </label>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity disabled:opacity-40"
          >
            {pending ? t('details.saving') : t('details.save')}
          </button>
          {saved ? <span className="text-xs text-accent">{t('details.saved')}</span> : null}
          {error ? <span role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
