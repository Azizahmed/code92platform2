'use client';

import {Mail, Pencil, Phone, Plus, Star, Trash2} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useState} from 'react';

import {
  createContactAction,
  deleteContactAction,
  updateContactAction,
  type ContactInput
} from '@/lib/actions/sales';
import type {Contact} from '@/lib/sales/types';
import {useServerAction} from '@/lib/use-server-action';

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

const EMPTY: ContactInput = {name: '', title: null, email: null, phone: null, notes: null, isPrimary: false};

function ContactForm({
  initial,
  onSubmit,
  onCancel,
  pending,
  error
}: {
  initial: ContactInput;
  onSubmit: (input: ContactInput) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const t = useTranslations('sales');
  const [form, setForm] = useState(initial);
  const set = (key: keyof ContactInput, value: string | boolean) => setForm((f) => ({...f, [key]: value}));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-3 rounded-md border border-hairline bg-bg/40 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} placeholder={t('contactFields.name')} aria-label={t('contactFields.name')} className={INPUT_CLASS} />
        <input value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} maxLength={200} placeholder={t('contactFields.title')} aria-label={t('contactFields.title')} className={INPUT_CLASS} />
        <input type="email" dir="ltr" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} maxLength={320} placeholder={t('contactFields.email')} aria-label={t('contactFields.email')} className={INPUT_CLASS} />
        <input type="tel" dir="ltr" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} maxLength={50} placeholder={t('contactFields.phone')} aria-label={t('contactFields.phone')} className={`${INPUT_CLASS} font-mono`} />
      </div>
      <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={2} maxLength={5000} placeholder={t('contactFields.notes')} aria-label={t('contactFields.notes')} className={INPUT_CLASS} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={form.isPrimary} onChange={(e) => set('isPrimary', e.target.checked)} className="accent-accent" />
          {t('contactFields.primary')}
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
            {t('actions.cancel')}
          </button>
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
            {pending ? t('actions.saving') : t('actions.save')}
          </button>
        </div>
      </div>
      {error ? <p className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </form>
  );
}

export default function ContactsPanel({accountId, contacts}: {accountId: string; contacts: Contact[]}) {
  const t = useTranslations('sales');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, runAction] = useServerAction();

  function run(action: () => Promise<{ok: boolean; error?: string}>) {
    setError(null);
    void runAction(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'generic');
        return;
      }
      setEditing(null);
    });
  }

  return (
    <div className="space-y-3">
      {contacts.length === 0 && editing !== 'new' ? <p className="text-xs text-faint">{t('contacts.none')}</p> : null}

      <ul className="space-y-2">
        {contacts.map((contact) =>
          editing === contact.id ? (
            <li key={contact.id}>
              <ContactForm
                initial={{name: contact.name, title: contact.title, email: contact.email, phone: contact.phone, notes: contact.notes, isPrimary: contact.is_primary}}
                onSubmit={(input) => run(() => updateContactAction(contact.id, input))}
                onCancel={() => setEditing(null)}
                pending={pending}
                error={error}
              />
            </li>
          ) : (
            <li key={contact.id} className="group flex items-start justify-between gap-3 rounded-md border border-hairline px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm text-ink">
                  {contact.name}
                  {contact.is_primary ? (
                    <span className="inline-flex items-center gap-1 rounded border border-amber/30 bg-amber/10 px-1 text-[9px] uppercase tracking-widest text-amber">
                      <Star className="h-2.5 w-2.5 fill-amber" strokeWidth={1.75} />
                      {t('contactFields.primary')}
                    </span>
                  ) : null}
                </div>
                {contact.title ? <div className="text-xs text-muted">{contact.title}</div> : null}
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
                {contact.notes ? <p className="mt-1 whitespace-pre-wrap text-xs text-faint">{contact.notes}</p> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                {!contact.is_primary ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => updateContactAction(contact.id, {name: contact.name, title: contact.title, email: contact.email, phone: contact.phone, notes: contact.notes, isPrimary: true}))}
                    aria-label={t('contacts.makePrimary')}
                    title={t('contacts.makePrimary')}
                    className="rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-amber"
                  >
                    <Star className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                ) : null}
                <button type="button" onClick={() => setEditing(contact.id)} aria-label={t('actions.edit')} className="rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink">
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(t('contacts.deleteConfirm', {name: contact.name}))) run(() => deleteContactAction(contact.id));
                  }}
                  aria-label={t('contacts.delete')}
                  className="rounded p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </li>
          )
        )}
      </ul>

      {editing === 'new' ? (
        <ContactForm
          initial={{...EMPTY, isPrimary: contacts.length === 0}}
          onSubmit={(input) => run(() => createContactAction(accountId, input))}
          onCancel={() => setEditing(null)}
          pending={pending}
          error={error}
        />
      ) : (
        <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-accent">
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t('contacts.add')}
        </button>
      )}
      {error && editing === null ? <p className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
