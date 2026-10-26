'use client';

import {useTranslations} from 'next-intl';
import {useState} from 'react';

import {useRouter} from '@/i18n/navigation';
import {createAccountAction, updateAccountAction} from '@/lib/actions/sales';
import type {MemberOption} from '@/lib/sales/types';
import {useServerAction} from '@/lib/use-server-action';

export type AccountFormInitial = {
  name: string;
  sector: string;
  city: string;
  ownerId: string;
  notes: string;
};

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

export default function AccountForm({
  mode,
  accountId,
  initial,
  members,
  sectors
}: {
  mode: 'create' | 'edit';
  accountId?: string;
  initial: AccountFormInitial;
  members: MemberOption[];
  // Existing sectors, offered as suggestions to keep the filter tidy.
  sectors: string[];
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const set = <K extends keyof AccountFormInitial>(key: K, value: string) =>
    setForm((current) => ({...current, [key]: value}));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const input = {
      name: form.name,
      sector: form.sector || null,
      city: form.city || null,
      ownerId: form.ownerId,
      notes: form.notes || null
    };
    void run(async () => {
      const result =
        mode === 'create' ? await createAccountAction(input) : await updateAccountAction(accountId!, input);
      // On success the action redirects to the account page itself.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-hairline bg-panel p-4 sm:p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-xs text-muted">{t('accountFields.name')}</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} className={INPUT_CLASS} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('accountFields.sector')}</span>
          <input value={form.sector} onChange={(e) => set('sector', e.target.value)} list="account-sectors" maxLength={100} className={INPUT_CLASS} />
          <datalist id="account-sectors">
            {sectors.map((sector) => (
              <option key={sector} value={sector} />
            ))}
          </datalist>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('accountFields.city')}</span>
          <input value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={100} className={INPUT_CLASS} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('accountFields.owner')}</span>
          <select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} required className={INPUT_CLASS}>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-xs text-muted">{t('accountFields.notes')}</span>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={4} maxLength={5000} className={INPUT_CLASS} />
        </label>
      </div>

      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} className="rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink">
          {t('actions.cancel')}
        </button>
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
          {pending ? t('actions.saving') : mode === 'create' ? t('actions.createAccount') : t('actions.save')}
        </button>
      </div>
    </form>
  );
}
