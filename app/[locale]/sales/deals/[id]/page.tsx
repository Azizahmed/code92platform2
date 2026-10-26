import {Building2, Pencil} from 'lucide-react';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';

import ActivityLog from '@/components/sales/ActivityLog';
import DealContactsPicker from '@/components/sales/DealContactsPicker';
import NextActionEditor from '@/components/sales/NextActionEditor';
import StageStepper from '@/components/sales/StageStepper';
import WatchersPanel from '@/components/sales/WatchersPanel';
import {DealStageChip, DealTypeChip, Money, StaleFlag} from '@/components/sales/chips';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {businessDate, formatDay} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {getActiveMembers} from '@/lib/sales/queries';
import {
  DEAL_OVERVIEW_COLUMNS,
  type Contact,
  type DealActivity,
  type DealRow,
  type Engagement
} from '@/lib/sales/types';

function Panel({title, children, action}: {title: string; children: React.ReactNode; action?: React.ReactNode}) {
  return (
    <section className="rounded-lg border border-hairline bg-panel">
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-faint">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default async function DealPage({params}: {params: Promise<{locale: string; id: string}>}) {
  const {locale, id} = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const {user} = await requireActiveMember();
  const t = await getTranslations('sales');
  const insforge = await createInsForgeServerClient();

  const [{data: dealRow}, {data: involved}, {data: activities}, {data: watchers}, {data: engagement}, members] =
    await Promise.all([
      insforge.database.from('deal_overview').select(DEAL_OVERVIEW_COLUMNS).eq('id', id).maybeSingle(),
      insforge.database.from('deal_contacts').select('contact_id').eq('deal_id', id),
      insforge.database
        .from('deal_activities')
        .select('id, deal_id, actor_id, kind, from_stage, to_stage, reason, body, meta, created_at')
        .eq('deal_id', id)
        .order('created_at', {ascending: false})
        .limit(200),
      insforge.database.from('deal_watchers').select('user_id').eq('deal_id', id),
      insforge.database
        .from('engagements')
        .select('id, account_id, deal_id, name, ownership, started_at, notes')
        .eq('deal_id', id)
        .maybeSingle(),
      getActiveMembers()
    ]);
  if (!dealRow) notFound();
  const deal = dealRow as unknown as DealRow;

  const {data: contacts} = await insforge.database
    .from('contacts')
    .select('id, account_id, name, title, email, phone, notes, is_primary')
    .eq('account_id', deal.account_id)
    .order('is_primary', {ascending: false})
    .order('name');

  const names = Object.fromEntries(members.map((member) => [member.userId, member.displayName]));
  const entries = ((activities ?? []) as unknown as DealActivity[]).map((entry) => ({
    ...entry,
    actor_name: entry.actor_id ? names[entry.actor_id] ?? null : null
  }));
  const today = businessDate();
  const won = engagement as Engagement | null;

  const facts: [string, React.ReactNode][] = [
    [t('fields.owner'), deal.owner_name ?? '—'],
    [t('fields.value'), <Money key="v" amount={deal.value_amount} currency={deal.currency} locale={locale} className="text-ink" />],
    [t('fields.expectedClose'), deal.expected_close ? <span key="c" className="font-mono">{formatDay(deal.expected_close, locale)}</span> : '—'],
    [t('fields.source'), deal.source ? t(`sources.${deal.source}`) : '—'],
    ...(deal.product_name
      ? ([[t('fields.product'), <Link key="p" href={`/products/${deal.product_id}`} className="hover:text-accent">{deal.product_name}</Link>]] as [string, React.ReactNode][])
      : []),
    [t('fields.created'), <span key="d" className="font-mono">{formatDay(deal.created_at.slice(0, 10), locale)}</span>]
  ];

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/sales/accounts/${deal.account_id}`} className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-accent">
            <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            {deal.account_name}
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{deal.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DealStageChip stage={deal.stage} />
            <DealTypeChip type={deal.type} />
            {deal.is_stale ? <StaleFlag /> : null}
            {deal.close_reason ? <span className="text-xs text-muted">— {deal.close_reason}</span> : null}
          </div>
        </div>
        <Link
          href={`/sales/deals/${deal.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t('actions.edit')}
        </Link>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Panel title={t('sections.stage')}>
            <StageStepper dealId={deal.id} dealName={deal.name} type={deal.type} stage={deal.stage} />
          </Panel>

          {won ? (
            <Panel title={t('sections.engagement')}>
              <Link href={`/sales/accounts/${deal.account_id}#engagements`} className="text-sm text-ink hover:text-accent">
                {won.name}
              </Link>
              <p className="mt-1 text-xs text-muted">{t(`ownership.${won.ownership}`)}</p>
            </Panel>
          ) : null}

          <Panel title={t('sections.activity')}>
            <ActivityLog dealId={deal.id} entries={entries} names={names} locale={locale} />
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel title={t('sections.nextAction')}>
            <NextActionEditor
              dealId={deal.id}
              nextAction={deal.next_action}
              nextActionDate={deal.next_action_date}
              isOpen={deal.is_open}
              isStale={deal.is_stale}
              today={today}
              locale={locale}
            />
          </Panel>

          <Panel title={t('sections.details')}>
            <dl className="space-y-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-faint">{label}</dt>
                  <dd className="min-w-0 truncate text-end text-muted">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title={t('sections.contacts')}>
            <DealContactsPicker
              dealId={deal.id}
              accountId={deal.account_id}
              contacts={(contacts ?? []) as Contact[]}
              selectedIds={(involved ?? []).map((row) => row.contact_id as string)}
            />
          </Panel>

          <Panel title={t('sections.watchers')}>
            <WatchersPanel
              recordType="deal"
              recordId={deal.id}
              ownerId={deal.owner_id}
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
