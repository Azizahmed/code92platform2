import {getTranslations} from 'next-intl/server';

import AccountForm from '@/components/sales/AccountForm';
import {requireActiveMember} from '@/lib/auth';
import {getAccountSectors, getActiveMembers} from '@/lib/sales/queries';

export default async function NewAccountPage() {
  const {user} = await requireActiveMember();
  const t = await getTranslations('sales');
  const [members, sectors] = await Promise.all([getActiveMembers(), getAccountSectors()]);

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('newAccountTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{t('newAccountSubtitle')}</p>
      </header>
      <AccountForm
        mode="create"
        initial={{name: '', sector: '', city: '', ownerId: user.id, notes: ''}}
        members={members}
        sectors={sectors}
      />
    </section>
  );
}
