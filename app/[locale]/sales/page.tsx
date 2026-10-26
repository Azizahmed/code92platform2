import {getTranslations} from 'next-intl/server';

import SalesBoard from '@/components/sales/SalesBoard';
import {requireActiveMember} from '@/lib/auth';
import {businessDate} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {DEAL_OVERVIEW_COLUMNS, type DealRow} from '@/lib/sales/types';

// Closed columns show the last quarter's outcomes; older closed deals stay
// on their account pages.
const CLOSED_WINDOW_DAYS = 90;

export default async function SalesHomePage({
  params,
  searchParams
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{type?: string; owner?: string; product?: string; view?: string}>;
}) {
  const [{locale}, filters] = await Promise.all([params, searchParams]);
  const {user} = await requireActiveMember();
  const t = await getTranslations('sales');
  const insforge = await createInsForgeServerClient();

  const closedSince = new Date(Date.now() - CLOSED_WINDOW_DAYS * 86_400_000).toISOString();

  const [{data: deals}, {data: members}, {data: products}] = await Promise.all([
    insforge.database
      .from('deal_overview')
      .select(DEAL_OVERVIEW_COLUMNS)
      .or(`is_open.eq.true,closed_at.gte.${closedSince}`)
      .order('expected_close', {ascending: true, nullsFirst: false})
      .limit(1000),
    insforge.database
      .from('team_members')
      .select('user_id, display_name')
      .eq('is_active', true)
      .eq('kind', 'human')
      .order('display_name'),
    insforge.database
      .from('products')
      .select('id, name')
      .is('archived_at', null)
      .order('name')
  ]);

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>

      <SalesBoard
        deals={(deals ?? []) as unknown as DealRow[]}
        members={(members ?? []).map((member) => ({
          userId: member.user_id as string,
          displayName: member.display_name as string
        }))}
        products={(products ?? []).map((product) => ({
          id: product.id as string,
          name: product.name as string
        }))}
        initialFilters={{
          type: filters.type === 'product' || filters.type === 'consultation' ? filters.type : 'all',
          owner: filters.owner ?? 'all',
          product: filters.product ?? 'all',
          view: filters.view === 'list' ? 'list' : 'kanban'
        }}
        currentUserId={user.id}
        today={businessDate()}
        locale={locale}
      />
    </section>
  );
}
