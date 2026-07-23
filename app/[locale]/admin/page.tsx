import {ShieldAlert} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import MembersTable, {type MemberRow} from '@/components/admin/MembersTable';
import ScanRunsPanel, {type ScanRunRow} from '@/components/admin/ScanRunsPanel';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

// Admin console: team roster management + trend-scan observability.
// Admin-only — active members with role 'member' get a clear 403 state.
export default async function AdminPage() {
  const {user, member} = await requireActiveMember();
  const t = await getTranslations('admin');

  if (member.role !== 'admin') {
    return (
      <section className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </header>
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-24 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-danger/30 bg-danger/10">
            <ShieldAlert className="h-5 w-5 text-danger" strokeWidth={1.5} />
          </span>
          <div className="text-sm font-medium">{t('forbidden.title')}</div>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {t('forbidden.body')}
          </p>
        </div>
      </section>
    );
  }

  const insforge = await createInsForgeServerClient();
  const [{data: members}, {data: runs}] = await Promise.all([
    insforge.database
      .from('team_members')
      .select('user_id, display_name, role, is_active, created_at')
      .order('created_at', {ascending: true}),
    insforge.database
      .from('scan_runs')
      .select(
        'id, status, products_scanned, items_inserted, items_linked, details, started_at, finished_at'
      )
      .order('started_at', {ascending: false})
      .limit(20)
  ]);

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>

      <MembersTable
        members={(members ?? []) as MemberRow[]}
        currentUserId={user.id}
      />
      <ScanRunsPanel runs={(runs ?? []) as ScanRunRow[]} />
    </section>
  );
}
