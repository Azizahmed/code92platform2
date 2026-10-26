'use client';

import {useTranslations} from 'next-intl';
import {useState} from 'react';

import {Link, useRouter} from '@/i18n/navigation';
import {createDealAction, updateDealAction} from '@/lib/actions/sales';
import {DEAL_SOURCES, OPEN_STAGES, type DealSource, type DealStage, type DealType} from '@/lib/sales/stages';
import type {Contact, MemberOption, ProductOption} from '@/lib/sales/types';
import {useServerAction} from '@/lib/use-server-action';

export type DealFormInitial = {
  accountId: string;
  name: string;
  type: DealType;
  productId: string;
  ownerId: string;
  stage: DealStage;
  valueAmount: string;
  currency: string;
  expectedClose: string;
  nextAction: string;
  nextActionDate: string;
  source: DealSource | '';
};

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';
const CURRENCIES = ['KWD', 'SAR', 'AED', 'USD', 'EUR'];

export default function DealForm({
  mode,
  dealId,
  initial,
  accounts,
  contacts,
  members,
  products
}: {
  mode: 'create' | 'edit';
  dealId?: string;
  initial: DealFormInitial;
  accounts: {id: string; name: string}[];
  // Contacts of the preselected account (create mode only).
  contacts: Contact[];
  members: MemberOption[];
  products: ProductOption[];
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const set = <K extends keyof DealFormInitial>(key: K, value: DealFormInitial[K]) =>
    setForm((current) => ({...current, [key]: value}));

  const showContacts = mode === 'create' && contacts.length > 0 && form.accountId === initial.accountId;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const value = form.valueAmount.trim() === '' ? null : Number(form.valueAmount);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError('invalid');
      return;
    }
    const deal = {
      name: form.name,
      type: form.type,
      productId: form.type === 'product' ? form.productId || null : null,
      ownerId: form.ownerId,
      valueAmount: value,
      currency: form.currency,
      expectedClose: form.expectedClose || null,
      nextAction: form.nextAction || null,
      nextActionDate: form.nextActionDate || null,
      source: form.source || null
    };
    if (deal.type === 'product' && !deal.productId) {
      setError('productRequired');
      return;
    }
    void run(async () => {
      const result =
        mode === 'create'
          ? await createDealAction({
              accountId: form.accountId,
              stage: form.stage,
              contactIds: showContacts ? contactIds : [],
              deal
            })
          : await updateDealAction(dealId!, deal);
      // On success the action redirects to the deal page itself.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-hairline bg-panel p-4 sm:p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-xs text-muted">{t('fields.name')}</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} className={INPUT_CLASS} />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('fields.account')}</span>
          {mode === 'create' ? (
            <select value={form.accountId} onChange={(e) => set('accountId', e.target.value)} required className={INPUT_CLASS}>
              <option value="" disabled>
                {t('fields.chooseAccount')}
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          ) : (
            <input value={accounts.find((a) => a.id === form.accountId)?.name ?? ''} disabled className={`${INPUT_CLASS} opacity-60`} />
          )}
          {mode === 'create' && accounts.length === 0 ? (
            <Link href="/sales/accounts/new" className="block text-[11px] text-accent">
              {t('fields.noAccounts')}
            </Link>
          ) : null}
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('fields.owner')}</span>
          <select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} required className={INPUT_CLASS}>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-1.5">
          <legend className="text-xs text-muted">{t('fields.type')}</legend>
          <div className="flex gap-1 rounded-md border border-hairline bg-bg p-1">
            {(['product', 'consultation'] as DealType[]).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={form.type === type}
                onClick={() => set('type', type)}
                className={`flex-1 rounded px-3 py-1.5 text-xs transition-colors ${form.type === type ? 'bg-raised text-ink' : 'text-faint hover:text-muted'}`}
              >
                {t(`types.${type}`)}
              </button>
            ))}
          </div>
        </fieldset>

        {form.type === 'product' ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('fields.product')}</span>
            <select value={form.productId} onChange={(e) => set('productId', e.target.value)} required className={INPUT_CLASS}>
              <option value="" disabled>
                {t('fields.chooseProduct')}
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="hidden sm:block" />
        )}

        {mode === 'create' ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('fields.stage')}</span>
            <select value={form.stage} onChange={(e) => set('stage', e.target.value as DealStage)} className={INPUT_CLASS}>
              {OPEN_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {t(`stages.${stage}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('fields.source')}</span>
          <select value={form.source} onChange={(e) => set('source', e.target.value as DealSource | '')} className={INPUT_CLASS}>
            <option value="">{t('fields.noSource')}</option>
            {DEAL_SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`sources.${source}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('fields.value')}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.001"
              value={form.valueAmount}
              onChange={(e) => set('valueAmount', e.target.value)}
              className={`${INPUT_CLASS} font-mono`}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('fields.currency')}</span>
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={`${INPUT_CLASS} font-mono`}>
              {[...new Set([form.currency, ...CURRENCIES])].map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('fields.expectedClose')}</span>
          <input type="date" value={form.expectedClose} onChange={(e) => set('expectedClose', e.target.value)} className={`${INPUT_CLASS} font-mono`} />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('fields.nextAction')}</span>
          <input value={form.nextAction} onChange={(e) => set('nextAction', e.target.value)} maxLength={500} placeholder={t('fields.nextActionPlaceholder')} className={INPUT_CLASS} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('fields.nextActionDate')}</span>
          <input type="date" value={form.nextActionDate} onChange={(e) => set('nextActionDate', e.target.value)} className={`${INPUT_CLASS} font-mono`} />
        </label>
      </div>

      {showContacts ? (
        <fieldset className="space-y-2">
          <legend className="text-xs text-muted">{t('fields.involvedContacts')}</legend>
          <div className="flex flex-wrap gap-2">
            {contacts.map((contact) => {
              const checked = contactIds.includes(contact.id);
              return (
                <label key={contact.id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${checked ? 'border-accent/40 bg-accent/5 text-ink' : 'border-hairline text-muted hover:bg-raised'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setContactIds((ids) => (checked ? ids.filter((id) => id !== contact.id) : [...ids, contact.id]))
                    }
                    className="accent-accent"
                  />
                  {contact.name}
                  {contact.title ? <span className="text-faint">· {contact.title}</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} className="rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink">
          {t('actions.cancel')}
        </button>
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
          {pending ? t('actions.saving') : mode === 'create' ? t('actions.createDeal') : t('actions.save')}
        </button>
      </div>
    </form>
  );
}
