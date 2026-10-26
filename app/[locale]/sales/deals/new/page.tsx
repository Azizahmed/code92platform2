import {getTranslations} from 'next-intl/server';

import DealForm from '@/components/sales/DealForm';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {getActiveMembers, getActiveProducts} from '@/lib/sales/queries';
import type {Contact} from '@/lib/sales/types';

export default async function NewDealPage({
  searchParams
}: {
  searchParams: Promise<{account?: string}>;
}) {
  const {account} = await searchParams;
  const {user} = await requireActiveMember();
  const t = await getTranslations('sales');
  const insforge = await createInsForgeServerClient();
  const accountId = account && /^[0-9a-f-]{36}$/i.test(account) ? account : '';

  const [{data: accounts}, members, products, {data: contacts}] = await Promise.all([
    insforge.database.from('accounts').select('id, name').is('archived_at', null).order('name'),
    getActiveMembers(),
    getActiveProducts(),
    accountId
      ? insforge.database
          .from('contacts')
          .select('id, account_id, name, title, email, phone, notes, is_primary')
          .eq('account_id', accountId)
          .order('is_primary', {ascending: false})
          .order('name')
      : Promise.resolve({data: []})
  ]);

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('newDealTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{t('newDealSubtitle')}</p>
      </header>
      <DealForm
        mode="create"
        initial={{
          accountId,
          name: '',
          type: 'consultation',
          productId: '',
          ownerId: user.id,
          stage: 'lead',
          valueAmount: '',
          currency: 'KWD',
          expectedClose: '',
          nextAction: '',
          nextActionDate: '',
          source: ''
        }}
        accounts={(accounts ?? []).map((row) => ({id: row.id as string, name: row.name as string}))}
        contacts={(contacts ?? []) as Contact[]}
        members={members}
        products={products}
      />
    </section>
  );
}
