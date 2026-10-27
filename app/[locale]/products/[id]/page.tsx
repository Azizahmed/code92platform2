import {notFound} from 'next/navigation';
import Image from 'next/image';
import {ChevronLeft, ExternalLink, Pencil} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import BusinessTab from '@/components/products/tabs/BusinessTab';
import DevelopmentTab from '@/components/products/tabs/DevelopmentTab';
import KnowledgeTab from '@/components/products/tabs/KnowledgeTab';
import SalesTab from '@/components/products/tabs/SalesTab';
import TasksTab from '@/components/products/tabs/TasksTab';
import ProductChannelsPanel from '@/components/products/ProductChannelsPanel';
import type {ProductOverviewRow} from '@/components/products/types';
import HealthBadge from '@/components/HealthBadge';
import OverdueBadge from '@/components/OverdueBadge';
import RiskTierChip from '@/components/risk/RiskTierChip';
import WatchButton from '@/components/watch/WatchButton';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {setProductWatchingAction} from '@/lib/actions/business';
import {BUSINESS_STAGES, isBusinessStage} from '@/lib/business-track';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {TaskMemberOption} from '@/components/products/ProductTasksPanel';
import type {ProductRepoLink} from '@/lib/github';

const TABS = ['business', 'development', 'sales', 'tasks', 'knowledge', 'channel'] as const;
type Tab = (typeof TABS)[number];

export default async function ProductDetailPage({
  params,
  searchParams
}: {
  params: Promise<{locale: string; id: string}>;
  searchParams: Promise<{tab?: string; track?: string; release?: string}>;
}) {
  const {locale, id} = await params;
  const query = await searchParams;
  const insforge = await createInsForgeServerClient();
  // Auth, translations and the product lookup start together; the rest of the
  // page waits on the product's owner and visibility, not on each other.
  const [{user, member}, [t, tb], {data: product}] = await Promise.all([
    requireActiveMember(),
    Promise.all([getTranslations('products'), getTranslations('business')]),
    insforge.database.from('products').select('*').eq('id', id).maybeSingle()
  ]);
  if (!product) notFound();

  const [
    {data: members},
    {data: overview},
    {data: watching},
    {data: githubConfigured}
  ] = await Promise.all([
    insforge.database.from('team_members').select('user_id, display_name').eq('is_active', true).order('display_name'),
    insforge.database.from('product_overview').select('*').eq('id', id).maybeSingle(),
    insforge.database.from('product_watchers').select('user_id').eq('product_id', id).eq('user_id', user.id),
    insforge.database.rpc('github_is_configured')
  ]);

  if (!overview) notFound();

  const p = product as unknown as {
    id: string;
    health: 'green' | 'yellow' | 'red' | 'unknown';
    owner_id: string;
    archived_at: string | null;
    next_review_at: string | null;
    review_interval_days: number;
    category: string | null;
    keywords: string[];
    links: Record<string, string>;
    description: string | null;
    description_ar: string | null;
    name: string;
    slug: string;
    logo_url: string | null;
    github_repo: string | null;
    github_repo_id: number | null;
    github_default_branch: string | null;
    github_linked_by: string | null;
    github_linked_at: string | null;
  };
  const o = overview as unknown as ProductOverviewRow;
  const isAdmin = member.role === 'admin';
  const isOwner = p.owner_id === user.id;
  const canManage = !p.archived_at && (isOwner || isAdmin || o.business_owner_id === user.id);
  const canEditProduct = !p.archived_at && (isOwner || isAdmin);

  if (p.archived_at && !isOwner && !isAdmin) notFound();

  const memberNames = new Map((members ?? []).map((m) => [m.user_id as string, m.display_name as string]));
  const memberOptions: TaskMemberOption[] = (members ?? []).map((m) => ({
    userId: m.user_id as string,
    displayName: m.display_name as string
  }));
  const memberList = memberOptions.map((m) => ({id: m.userId, name: m.displayName}));
  const authorNames = Object.fromEntries(memberNames);

  const activeTab: Tab = (TABS as readonly string[]).includes(query.tab ?? '')
    ? (query.tab as Tab)
    : 'business';
  const repo: ProductRepoLink = {
    github_repo: p.github_repo,
    github_repo_id: p.github_repo_id,
    github_default_branch: p.github_default_branch,
    github_linked_by: p.github_linked_by,
    github_linked_at: p.github_linked_at
  };

  const dateFormat = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric'});
  const overdue = p.next_review_at !== null && new Date(p.next_review_at).getTime() < Date.now();
  const stage = isBusinessStage(o.business_stage) ? o.business_stage : BUSINESS_STAGES[0];
  const links = Object.entries(p.links ?? {});

  const tabHref = (tab: Tab) => `?tab=${tab}`;

  return (
    <section className="space-y-6">
      <div>
        <Link href="/products" className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink">
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
          {t('detail.back')}
        </Link>
      </div>

      <header className="rounded-lg border border-hairline bg-panel p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {p.logo_url ? (
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-hairline bg-raised">
                <Image src={p.logo_url} alt={p.name} fill unoptimized sizes="56px" className="object-cover" priority />
              </div>
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-hairline bg-raised font-mono text-lg font-semibold text-faint">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold">{p.name}</h1>
                <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                  {tb(`stages.${stage}`)}
                </span>
                {o.current_release_version ? (
                  <span dir="ltr" className="rounded border border-hairline bg-raised px-2 py-0.5 font-mono text-[11px] text-muted">
                    {o.current_release_version}
                    {o.current_release_stage ? ` · ${tb(`release.stage.${o.current_release_stage}`)}` : ''}
                  </span>
                ) : null}
                <HealthBadge health={p.health as 'green' | 'yellow' | 'red' | 'unknown'} />
                <RiskTierChip riskTier={o.risk_tier} />
                {p.archived_at ? (
                  <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">
                    {t('detail.archivedTag')}
                  </span>
                ) : null}
              </div>
              <div dir="ltr" className="font-mono text-xs text-faint">{p.slug}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WatchButton
              watching={(watching ?? []).length > 0}
              action={setProductWatchingAction.bind(null, p.id)}
              labels={{watch: tb('watch.watch'), watching: tb('watch.watching')}}
            />
            {canEditProduct ? (
              <Link
                href={`/products/${p.id}/edit`}
                className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <Pencil className="h-4 w-4" strokeWidth={1.75} />
                {t('detail.edit')}
              </Link>
            ) : null}
          </div>
        </div>

        {p.description || p.description_ar ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {p.description ? (
              <p dir="ltr" className="text-start text-sm leading-relaxed text-muted">{p.description}</p>
            ) : null}
            {p.description_ar ? (
              <p dir="rtl" className="text-start text-sm leading-relaxed text-muted">{p.description_ar}</p>
            ) : null}
          </div>
        ) : null}

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-hairline pt-5 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('detail.owner')}</dt>
            <dd className="mt-1 text-sm">{memberNames.get(p.owner_id) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{tb('details.operatorName')}</dt>
            <dd className="mt-1 text-sm">{o.operator_name ?? tb('details.noOperator')}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{tb('details.businessOwner')}</dt>
            <dd className="mt-1 text-sm">{o.business_owner_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('detail.nextReview')}</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm">
              {p.next_review_at ? (
                <time dateTime={p.next_review_at} className="font-mono text-xs text-muted">
                  {dateFormat.format(new Date(p.next_review_at))}
                </time>
              ) : (
                '—'
              )}
              {overdue && !p.archived_at ? <OverdueBadge /> : null}
            </dd>
          </div>
        </dl>

        {links.length > 0 || p.keywords.length > 0 ? (
          <div className="mt-5 flex flex-wrap items-start gap-6 border-t border-hairline pt-5">
            {p.keywords.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {p.keywords.map((kw) => (
                  <span key={kw} className="rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
                    {kw}
                  </span>
                ))}
              </div>
            ) : null}
            {links.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {links.map(([label, url]) => (
                  <a key={label} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    {label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {p.archived_at ? (
        <p className="rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber">{t('edit.archivedNotice')}</p>
      ) : null}

      <nav aria-label={t('tabs.label')} className="-mx-1 flex gap-1 overflow-x-auto border-b border-hairline px-1">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={tabHref(tab)}
            aria-current={activeTab === tab ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
              activeTab === tab
                ? 'border-accent font-medium text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t(`tabs.${tab}`)}
          </Link>
        ))}
      </nav>

      {activeTab === 'business' ? (
        <BusinessTab
          product={o}
          members={memberList}
          founder={member.is_founder}
          canManage={canManage}
          locale={locale}
        />
      ) : null}

      {activeTab === 'development' ? (
        <DevelopmentTab
          product={o}
          repo={repo}
          canManage={canEditProduct}
          canCreateRelease={canManage && ['build', 'venture', 'company', 'board'].includes(o.business_stage)}
          githubConfigured={Boolean(githubConfigured)}
          currentUserId={user.id}
          isAdmin={isAdmin}
          authorNames={authorNames}
          locale={locale}
        />
      ) : null}

      {activeTab === 'sales' ? <SalesTab productId={p.id} locale={locale} /> : null}

      {activeTab === 'tasks' ? (
        <TasksTab
          productId={p.id}
          currentUserId={user.id}
          members={memberOptions}
          disabled={Boolean(p.archived_at)}
          locale={locale}
        />
      ) : null}

      {activeTab === 'knowledge' ? (
        <KnowledgeTab
          productId={p.id}
          track={query.track === 'business' || query.track === 'development' ? query.track : 'all'}
          releaseId={query.release ?? null}
        />
      ) : null}

      {activeTab === 'channel' ? <ProductChannelsPanel productId={p.id} /> : null}
    </section>
  );
}
