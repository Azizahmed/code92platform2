'use client';

import {Building2, Search} from 'lucide-react';
import {useLocale, useTranslations} from 'next-intl';
import {useMemo, useState} from 'react';

import {Link} from '@/i18n/navigation';
import type {AccountRow, MemberOption} from '@/lib/sales/types';

const SELECT_CLASS =
  'rounded-md border border-hairline bg-bg px-2.5 py-2 text-xs text-muted outline-none transition-colors focus:border-accent/50';

export default function AccountsTable({
  accounts,
  members,
  currentUserId,
  initialOwner,
  initialSector
}: {
  accounts: AccountRow[];
  members: MemberOption[];
  currentUserId: string;
  initialOwner: string;
  initialSector: string;
}) {
  const t = useTranslations('sales');
  const locale = useLocale();
  const [owner, setOwner] = useState(initialOwner);
  const [sector, setSector] = useState(initialSector);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const sectors = useMemo(
    () => [...new Set(accounts.map((account) => account.sector).filter(Boolean) as string[])].sort(),
    [accounts]
  );

  function sync(key: 'owner' | 'sector', value: string) {
    const url = new URL(window.location.href);
    if (value === 'all') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState(null, '', url);
  }

  const visible = accounts.filter((account) => {
    if (!showArchived && account.archived_at) return false;
    if (owner === 'me' && account.owner_id !== currentUserId) return false;
    if (owner !== 'all' && owner !== 'me' && account.owner_id !== owner) return false;
    if (sector !== 'all' && account.sector !== sector) return false;
    if (query && !account.name.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-panel p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('filters.searchAccounts')}
            className="w-full rounded-md border border-hairline bg-bg py-2 ps-9 pe-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
        </div>
        <select aria-label={t('filters.owner')} value={owner} onChange={(e) => { setOwner(e.target.value); sync('owner', e.target.value); }} className={SELECT_CLASS}>
          <option value="all">{t('filters.allOwners')}</option>
          <option value="me">{t('filters.mine')}</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
            </option>
          ))}
        </select>
        <select aria-label={t('filters.sector')} value={sector} onChange={(e) => { setSector(e.target.value); sync('sector', e.target.value); }} className={SELECT_CLASS}>
          <option value="all">{t('filters.allSectors')}</option>
          {sectors.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-hairline bg-bg px-2.5 py-2 text-xs text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          {t('filters.showArchived')}
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-14 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
            <Building2 className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-3 text-sm font-medium">{t('empty.accountsTitle')}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t('empty.accountsBody')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-hairline bg-raised/30 text-[10px] uppercase tracking-widest text-faint">
                <th className="px-4 py-2.5 text-start font-normal">{t('accountColumns.name')}</th>
                <th className="px-3 py-2.5 text-start font-normal">{t('accountColumns.sector')}</th>
                <th className="px-3 py-2.5 text-start font-normal">{t('accountColumns.owner')}</th>
                <th className="px-3 py-2.5 text-end font-normal">{t('accountColumns.openDeals')}</th>
                <th className="px-4 py-2.5 text-start font-normal">{t('accountColumns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((account) => (
                <tr key={account.id} className="border-b border-hairline transition-colors last:border-0 hover:bg-raised/35">
                  <td className="px-4 py-2.5">
                    <Link href={`/sales/accounts/${account.id}`} className="font-medium text-ink transition-colors hover:text-accent">
                      {account.name}
                    </Link>
                    {account.city ? <span className="ms-2 text-[11px] text-faint">{account.city}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">{account.sector ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{account.owner_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-end font-mono text-xs text-ink">{account.open_deals}</td>
                  <td className="px-4 py-2.5">
                    {account.archived_at ? (
                      <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">{t('accountStatus.archived')}</span>
                    ) : account.customer_of_count > 0 ? (
                      <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">{t('accountStatus.customer')}</span>
                    ) : (
                      <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">{t('accountStatus.prospect')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
