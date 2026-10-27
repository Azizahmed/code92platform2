import {getTranslations} from 'next-intl/server';

import ProjectForm from '@/components/projects/ProjectForm';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {businessDate} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';

// A project can be opened straight from an account, or from scratch. A
// consultation deal won in Sales opens one of these on its own.
export default async function NewProjectPage({
  searchParams
}: {
  searchParams: Promise<{account?: string}>;
}) {
  const {account} = await searchParams;
  const {user} = await requireActiveMember();
  const t = await getTranslations('projects');
  const insforge = await createInsForgeServerClient();
  const [{data: accounts}, {data: members}] = await Promise.all([
    insforge.database.from('accounts').select('id, name').is('archived_at', null).order('name'),
    insforge.database.from('team_members').select('user_id, display_name').eq('is_active', true).order('display_name')
  ]);

  const today = businessDate();

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <Link href="/projects" className="text-xs text-muted transition-colors hover:text-ink">
        {t('detail.back')}
      </Link>
      <header>
        <h1 className="text-xl font-semibold">{t('new.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('new.subtitle')}</p>
      </header>
      <ProjectForm
        mode="create"
        accounts={(accounts ?? []).map((row) => ({id: row.id as string, name: row.name as string}))}
        members={(members ?? []).map((row) => ({id: row.user_id as string, name: row.display_name as string}))}
        initial={{name: '', ownerId: user.id, startDate: today, targetEndDate: '', ownership: '', notes: ''}}
        accountId={account}
        today={today}
      />
    </section>
  );
}
