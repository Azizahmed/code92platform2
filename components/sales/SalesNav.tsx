'use client';

import {Building2, Handshake, Plus} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {Link, usePathname} from '@/i18n/navigation';

export default function SalesNav() {
  const t = useTranslations('sales');
  const pathname = usePathname();
  const onAccounts = pathname.startsWith('/sales/accounts');

  const tabs = [
    {href: '/sales', label: t('nav.pipeline'), icon: Handshake, active: !onAccounts},
    {href: '/sales/accounts', label: t('nav.accounts'), icon: Building2, active: onAccounts}
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline">
      <nav aria-label={t('title')} className="-mb-px flex gap-1">
        {tabs.map(({href, label, icon: Icon, active}) => (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mb-2 flex gap-2">
        <Link
          href="/sales/accounts/new"
          className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t('actions.newAccount')}
        </Link>
        <Link
          href="/sales/deals/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          {t('actions.newDeal')}
        </Link>
      </div>
    </div>
  );
}
