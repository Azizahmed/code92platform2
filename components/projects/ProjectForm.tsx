'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import {createProjectAction, updateProjectAction, type ProjectInput} from '@/lib/actions/projects';
import {CODE_OWNERSHIPS} from '@/lib/projects';
import {useServerAction} from '@/lib/use-server-action';
import {Link, useRouter} from '@/i18n/navigation';
import {pushAfterAction} from '@/lib/navigation-guard';

export type PersonOption = {id: string; name: string};

export type ProjectFormValues = {
  name: string;
  ownerId: string;
  startDate: string;
  targetEndDate: string;
  ownership: string;
  notes: string;
};

// Create a project from an account, or edit one. A project created here is
// the same kind of record a won consultation deal opens.
export default function ProjectForm({
  mode,
  projectId,
  accounts,
  members,
  initial,
  accountId,
  today
}: {
  mode: 'create' | 'edit';
  projectId?: string;
  accounts?: {id: string; name: string}[];
  members: PersonOption[];
  initial: ProjectFormValues;
  accountId?: string;
  today: string;
}) {
  const t = useTranslations('projects');
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [account, setAccount] = useState(accountId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const input =
    'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';
  const set = (key: keyof ProjectFormValues, next: string) =>
    setValue((current) => ({...current, [key]: next}));

  const valid = value.name.trim().length > 0 && value.ownerId.length > 0 && (mode === 'edit' || account.length > 0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    const payload: ProjectInput = {
      name: value.name.trim(),
      ownerId: value.ownerId,
      startDate: value.startDate || today,
      targetEndDate: value.targetEndDate || null,
      ownership: (value.ownership || null) as ProjectInput['ownership'],
      notes: value.notes.trim() || null
    };
    void run(async () => {
      if (mode === 'create') {
        const result = await createProjectAction({accountId: account, project: payload});
        if (!result.ok || !result.id) {
          setError(result.ok ? 'generic' : result.error);
          return;
        }
        pushAfterAction(router, `/projects/${result.id}`);
        return;
      }
      const result = await updateProjectAction(projectId!, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      pushAfterAction(router, `/projects/${projectId}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === 'create' ? (
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs text-muted">{t('form.account')}</span>
            <select value={account} onChange={(event) => setAccount(event.target.value)} required className={input}>
              <option value="">{t('form.pickAccount')}</option>
              {(accounts ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-xs text-muted">{t('form.name')}</span>
          <input value={value.name} onChange={(event) => set('name', event.target.value)} maxLength={200} required className={input} />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.owner')}</span>
          <select value={value.ownerId} onChange={(event) => set('ownerId', event.target.value)} required className={input}>
            <option value="">{t('form.pickOwner')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.ownership')}</span>
          <select value={value.ownership} onChange={(event) => set('ownership', event.target.value)} className={input}>
            <option value="">{t('form.notSet')}</option>
            {CODE_OWNERSHIPS.map((option) => (
              <option key={option} value={option}>{t(`ownership.${option}`)}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.startDate')}</span>
          <input type="date" value={value.startDate} onChange={(event) => set('startDate', event.target.value)} className={input} />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.targetEnd')}</span>
          <input type="date" value={value.targetEndDate} min={value.startDate || undefined} onChange={(event) => set('targetEndDate', event.target.value)} className={input} />
        </label>

        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-xs text-muted">{t('form.notes')}</span>
          <textarea value={value.notes} onChange={(event) => set('notes', event.target.value)} rows={3} maxLength={5000} className={input} />
        </label>
      </div>

      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}

      <div className="flex justify-end gap-2">
        <Link href={mode === 'create' ? '/projects' : `/projects/${projectId}`} className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
          {t('actions.cancel')}
        </Link>
        <button type="submit" disabled={pending || !valid} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity disabled:opacity-40">
          {pending ? t('form.saving') : mode === 'create' ? t('form.create') : t('form.save')}
        </button>
      </div>
    </form>
  );
}
