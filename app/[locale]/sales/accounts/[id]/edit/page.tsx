import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';

import AccountForm from '@/components/sales/AccountForm';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {getAccountSectors, getActiveMembers} from '@/lib/sales/queries';

export default async function EditAccountPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  await requireActiveMember();
  const t = await getTranslations('sales');
  const insforge = await createInsForgeServerClient();

  const [{data: account}, members, sectors] = await Promise.all([
    insforge.database
      .from('accounts')
      .select('id, name, sector, city, owner_id, notes')
      .eq('id', id)
      .maybeSingle(),
    getActiveMembers(),
    getAccountSectors()
  ]);
  if (!account) notFound();

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('editAccountTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{account.name as string}</p>
      </header>
      <AccountForm
        mode="edit"
        accountId={id}
        initial={{
          name: account.name as string,
          sector: (account.sector as string | null) ?? '',
          city: (account.city as string | null) ?? '',
          ownerId: account.owner_id as string,
          notes: (account.notes as string | null) ?? ''
        }}
        members={members}
        sectors={sectors}
      />
    </section>
  );
}
