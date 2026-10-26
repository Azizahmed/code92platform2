import {getTranslations} from 'next-intl/server';

import AccountsTable from '@/components/sales/AccountsTable';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {getActiveMembers} from '@/lib/sales/queries';
import {ACCOUNT_OVERVIEW_COLUMNS, type AccountRow} from '@/lib/sales/types';

export default async function AccountsPage({
  searchParams
}: {
  searchParams: Promise<{owner?: string; sector?: string}>;
}) {
  const filters = await searchParams;
  const {user} = await requireActiveMember();
  const t = await getTranslations('sales');
  const insforge = await createInsForgeServerClient();

  const [{data: accounts}, members] = await Promise.all([
    insforge.database.from('account_overview').select(ACCOUNT_OVERVIEW_COLUMNS).order('name').limit(2000),
    getActiveMembers()
  ]);

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('accountsTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{t('accountsSubtitle')}</p>
      </header>
      <AccountsTable
        accounts={(accounts ?? []) as unknown as AccountRow[]}
        members={members}
        currentUserId={user.id}
        initialOwner={filters.owner ?? 'all'}
        initialSector={filters.sector ?? 'all'}
      />
    </section>
  );
}
