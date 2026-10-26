'use client';

import {Mail, Phone, Star} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useState} from 'react';

import {Link} from '@/i18n/navigation';
import {setDealContactsAction} from '@/lib/actions/sales';
import type {Contact} from '@/lib/sales/types';
import {useServerAction} from '@/lib/use-server-action';

// Involved contacts: a subset of the account's contacts.
export default function DealContactsPicker({
  dealId,
  accountId,
  contacts,
  selectedIds
}: {
  dealId: string;
  accountId: string;
  contacts: Contact[];
  selectedIds: string[];
}) {
  const t = useTranslations('sales');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(selectedIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const involved = contacts.filter((contact) => selectedIds.includes(contact.id));

  function save() {
    setError(null);
    void run(async () => {
      const result = await setDealContactsAction(dealId, selected);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  if (contacts.length === 0) {
    return (
      <p className="text-xs text-faint">
        {t('contacts.noneOnAccount')}{' '}
        <Link href={`/sales/accounts/${accountId}`} className="text-accent">
          {t('contacts.addOnAccount')}
        </Link>
      </p>
    );
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <ul className="space-y-1">
          {contacts.map((contact) => {
            const checked = selected.includes(contact.id);
            return (
              <li key={contact.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-raised/50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelected((ids) => (checked ? ids.filter((id) => id !== contact.id) : [...ids, contact.id]))}
                    className="accent-accent"
                  />
                  <span className="text-ink">{contact.name}</span>
                  {contact.title ? <span className="truncate text-xs text-faint">{contact.title}</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
        {error ? <p className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setSelected(selectedIds); setEditing(false); }} className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
            {t('actions.cancel')}
          </button>
          <button type="button" onClick={save} disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
            {pending ? t('actions.saving') : t('actions.save')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {involved.length === 0 ? (
        <p className="text-xs text-faint">{t('contacts.noneInvolved')}</p>
      ) : (
        <ul className="space-y-2">
          {involved.map((contact) => (
            <li key={contact.id} className="rounded-md border border-hairline px-3 py-2">
              <div className="flex items-center gap-1.5 text-sm text-ink">
                {contact.name}
                {contact.is_primary ? <Star className="h-3 w-3 fill-amber text-amber" strokeWidth={1.75} /> : null}
              </div>
              {contact.title ? <div className="text-[11px] text-faint">{contact.title}</div> : null}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} dir="ltr" className="inline-flex items-center gap-1 hover:text-accent">
                    <Mail className="h-3 w-3" strokeWidth={1.75} />
                    {contact.email}
                  </a>
                ) : null}
                {contact.phone ? (
                  <a href={`tel:${contact.phone}`} dir="ltr" className="inline-flex items-center gap-1 font-mono hover:text-accent">
                    <Phone className="h-3 w-3" strokeWidth={1.75} />
                    {contact.phone}
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setEditing(true)} className="text-xs text-muted transition-colors hover:text-accent">
        {t('contacts.choose')}
      </button>
    </div>
  );
}
