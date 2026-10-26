import {MapPin, Pencil, Plus} from 'lucide-react';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';

import ActivityLog from '@/components/sales/ActivityLog';
import ArchiveAccountButton from '@/components/sales/ArchiveAccountButton';
import ContactsPanel from '@/components/sales/ContactsPanel';
import DealsTable from '@/components/sales/DealsTable';
import EngagementsPanel from '@/components/sales/EngagementsPanel';
import WatchersPanel from '@/components/sales/WatchersPanel';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {businessDate, formatDay} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {getActiveMembers} from '@/lib/sales/queries';
import {
  ACCOUNT_OVERVIEW_COLUMNS,
  DEAL_OVERVIEW_COLUMNS,
  type AccountRow,
  type Contact,
  type DealActivity,
  type DealRow,
  type Engagement
} from '@/lib/sales/types';

function Panel({id, title, children, action}: {id?: string; title: string; children: React.ReactNode; action?: React.ReactNode}) {
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border border-hairline bg-panel">
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-faint">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default async function AccountPage({params}: {params: Promise<{locale: string; id: string}>}) {
  const {locale, id} = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const {user} = await requireActiveMember();
  const t = await getTranslations('sales');
  const insforge = await createInsForgeServerClient();

  const [
    {data: accountRow},
    {data: contacts},
    {data: deals},
    {data: engagements},
    {data: customerOf},
    {data: watchers},
    members
  ] = await Promise.all([
    insforge.database.from('account_overview').select(ACCOUNT_OVERVIEW_COLUMNS).eq('id', id).maybeSingle(),
    insforge.database
      .from('contacts')
      .select('id, account_id, name, title, email, phone, notes, is_primary')
      .eq('account_id', id)
      .order('is_primary', {ascending: false})
      .order('name'),
    insforge.database
      .from('deal_overview')
      .select(DEAL_OVERVIEW_COLUMNS)
      .eq('account_id', id)
      .order('created_at', {ascending: false}),
    insforge.database
      .from('engagements')
      .select('id, account_id, deal_id, name, ownership, started_at, notes')
      .eq('account_id', id)
      .order('started_at', {ascending: false}),
    insforge.database.from('account_products').select('product_id, since, won_deal_id').eq('account_id', id),
    insforge.database.from('account_watchers').select('user_id').eq('account_id', id),
    getActiveMembers()
  ]);
  if (!accountRow) notFound();
  const account = accountRow as unknown as AccountRow;
  const dealRows = (deals ?? []) as unknown as DealRow[];
  const dealIds = dealRows.map((deal) => deal.id);
  const productIds = (customerOf ?? []).map((row) => row.product_id as string);

  // Second wave: history across the account's deals, and product names.
  const [{data: activities}, {data: products}] = await Promise.all([
    dealIds.length
      ? insforge.database
          .from('deal_activities')
          .select('id, deal_id, actor_id, kind, from_stage, to_stage, reason, body, meta, created_at')
          .in('deal_id', dealIds)
          .neq('kind', 'field_change')
          .order('created_at', {ascending: false})
          .limit(50)
      : Promise.resolve({data: []}),
    productIds.length
      ? insforge.database.from('products').select('id, name').in('id', productIds)
      : Promise.resolve({data: []})
  ]);

  const names = Object.fromEntries(members.map((member) => [member.userId, member.displayName]));
  const dealNames = new Map(dealRows.map((deal) => [deal.id, deal.name]));
  const productNames = new Map((products ?? []).map((product) => [product.id as string, product.name as string]));
  const history = ((activities ?? []) as unknown as DealActivity[]).map((entry) => ({
    ...entry,
    actor_name: entry.actor_id ? names[entry.actor_id] ?? null : null,
    deal_name: dealNames.get(entry.deal_id)
  }));
  const today = businessDate();

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{account.name}</h1>
            {account.archived_at ? (
              <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">{t('accountStatus.archived')}</span>
            ) : account.customer_of_count > 0 ? (
              <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">{t('accountStatus.customer')}</span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {account.sector ? <span>{account.sector}</span> : null}
            {account.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" strokeWidth={1.75} />
                {account.city}
              </span>
            ) : null}
            <span>
              {t('fields.owner')}: <span className="text-ink">{account.owner_name ?? '—'}</span>
            </span>
          </div>
          {account.notes ? <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-muted">{account.notes}</p> : null}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link href={`/sales/accounts/${id}/edit`} className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('actions.edit')}
          </Link>
          <ArchiveAccountButton accountId={id} archived={Boolean(account.archived_at)} />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Panel
            title={t('sections.deals')}
            action={
              account.archived_at ? null : (
                <Link href={`/sales/deals/new?account=${id}`} className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-accent">
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t('actions.newDeal')}
                </Link>
              )
            }
          >
            <DealsTable deals={dealRows} today={today} locale={locale} hideAccount />
          </Panel>

          <Panel id="engagements" title={t('sections.engagements')}>
            <EngagementsPanel engagements={(engagements ?? []) as Engagement[]} locale={locale} />
          </Panel>

          <Panel title={t('sections.history')}>
            <ActivityLog entries={history} names={names} locale={locale} />
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel title={t('sections.contacts')}>
            <ContactsPanel accountId={id} contacts={(contacts ?? []) as Contact[]} />
          </Panel>

          <Panel title={t('sections.customerOf')}>
            {(customerOf ?? []).length === 0 ? (
              <p className="text-xs text-faint">{t('customerOf.none')}</p>
            ) : (
              <ul className="space-y-2">
                {(customerOf ?? []).map((row) => (
                  <li key={row.product_id as string} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/products/${row.product_id}`} className="truncate text-ink hover:text-accent">
                      {productNames.get(row.product_id as string) ?? '—'}
                    </Link>
                    <span className="shrink-0 font-mono text-[11px] text-faint">
                      {t('customerOf.since', {date: formatDay((row.since as string).slice(0, 10), locale)})}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t('sections.watchers')}>
            <WatchersPanel
              recordType="account"
              recordId={id}
              ownerId={account.owner_id}
              watcherIds={(watchers ?? []).map((row) => row.user_id as string)}
              members={members}
              currentUserId={user.id}
            />
          </Panel>
        </aside>
      </div>
    </section>
  );
}
