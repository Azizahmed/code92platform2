import {ChevronLeft, ExternalLink, Pencil, Rss} from 'lucide-react';
import {notFound} from 'next/navigation';
import {getFormatter, getTranslations} from 'next-intl/server';

import HealthBadge, {type Health} from '@/components/HealthBadge';
import OverdueBadge from '@/components/OverdueBadge';
import RelativeTime from '@/components/RelativeTime';
import StageChip, {type Stage} from '@/components/StageChip';
import StatusUpdateForm from '@/components/products/StatusUpdateForm';
import {ProductTrendsPanel} from '@/components/trends/ProductTrendsPanel';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import type {Product} from '@/lib/actions/products';
import {createInsForgeServerClient} from '@/lib/insforge/server';

type StatusUpdate = {
  id: string;
  health: Health;
  stage: Stage | null;
  summary: string;
  details: string | null;
  author_id: string | null;
  created_at: string;
};

export default async function ProductDetailPage({
  params
}: {
  params: Promise<{locale: string; id: string}>;
}) {
  const {locale, id} = await params;
  const {user, member} = await requireActiveMember();
  const [t, format] = await Promise.all([
    getTranslations('products'),
    getFormatter()
  ]);

  const insforge = await createInsForgeServerClient();
  const {data: product} = await insforge.database
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!product) notFound();

  const p = product as unknown as Product;
  const isAdmin = member.role === 'admin';
  const isOwner = p.owner_id === user.id;

  // Archived products stay viewable for owner/admin; everyone else gets 404.
  if (p.archived_at && !isOwner && !isAdmin) notFound();

  const [{data: members}, {data: updates}] = await Promise.all([
    insforge.database.from('team_members').select('user_id, display_name'),
    insforge.database
      .from('status_updates')
      .select('id, health, stage, summary, details, author_id, created_at')
      .eq('product_id', id)
      .order('created_at', {ascending: false})
  ]);

  const memberNames = new Map<string, string>(
    (members ?? []).map((m) => [m.user_id as string, m.display_name as string])
  );
  const timeline = (updates ?? []) as unknown as StatusUpdate[];
  const overdue =
    p.next_review_at !== null && new Date(p.next_review_at).getTime() < Date.now();
  const links = Object.entries(p.links ?? {});

  return (
    <section className="space-y-6">
      <div>
        <Link
          href="/products"
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
          {t('detail.back')}
        </Link>
      </div>

      <header className="rounded-lg border border-hairline bg-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold">{p.name}</h1>
              <StageChip stage={p.stage} />
              <HealthBadge health={p.health} />
              {p.archived_at ? (
                <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">
                  {t('detail.archivedTag')}
                </span>
              ) : null}
            </div>
            <div dir="ltr" className="font-mono text-xs text-faint">
              {p.slug}
            </div>
          </div>
          {isOwner || isAdmin ? (
            <Link
              href={`/products/${p.id}/edit`}
              className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Pencil className="h-4 w-4" strokeWidth={1.75} />
              {t('detail.edit')}
            </Link>
          ) : null}
        </div>

        {p.description || p.description_ar ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {p.description ? (
              <p dir="ltr" className="text-start text-sm leading-relaxed text-muted">
                {p.description}
              </p>
            ) : null}
            {p.description_ar ? (
              <p dir="rtl" className="text-start text-sm leading-relaxed text-muted">
                {p.description_ar}
              </p>
            ) : null}
          </div>
        ) : null}

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-hairline pt-5 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.owner')}
            </dt>
            <dd className="mt-1 text-sm">{memberNames.get(p.owner_id) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.category')}
            </dt>
            <dd className="mt-1 text-sm">{p.category ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.nextReview')}
            </dt>
            <dd className="mt-1 flex items-center gap-2 text-sm">
              {p.next_review_at ? (
                <time
                  dateTime={p.next_review_at}
                  className="font-mono text-xs text-muted"
                >
                  {format.dateTime(new Date(p.next_review_at), {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </time>
              ) : (
                '—'
              )}
              {overdue && !p.archived_at ? <OverdueBadge /> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('fields.reviewInterval')}
            </dt>
            <dd className="mt-1 text-sm text-muted">
              {t('detail.reviewEvery', {days: p.review_interval_days})}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('fields.trendScan')}
            </dt>
            <dd className="mt-1 flex items-center gap-1.5 text-sm">
              <Rss
                className={`h-3.5 w-3.5 ${p.trend_scan_enabled ? 'text-accent' : 'text-faint'}`}
                strokeWidth={1.75}
              />
              <span className={p.trend_scan_enabled ? 'text-muted' : 'text-faint'}>
                {p.trend_scan_enabled
                  ? t('detail.trendScanOn')
                  : t('detail.trendScanOff')}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.lastScan')}
            </dt>
            <dd className="mt-1 text-sm">
              {p.last_trend_scan_at ? (
                <RelativeTime date={p.last_trend_scan_at} />
              ) : (
                <span className="text-xs text-faint">
                  {t('detail.notScanned')}
                </span>
              )}
            </dd>
          </div>
        </dl>

        {p.keywords.length > 0 || links.length > 0 ? (
          <div className="mt-5 flex flex-wrap items-start gap-6 border-t border-hairline pt-5">
            {p.keywords.length > 0 ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-faint">
                  {t('detail.keywords')}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {links.length > 0 ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-faint">
                  {t('detail.links')}
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {links.map(([label, url]) => (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                      {label}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {p.archived_at ? (
        <p className="rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber">
          {t('edit.archivedNotice')}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-medium">{t('detail.timelineTitle')}</h2>
          {timeline.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center">
              <div className="text-sm font-medium">
                {t('detail.timelineEmptyTitle')}
              </div>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
                {t('detail.timelineEmptyBody')}
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {timeline.map((u) => (
                <li
                  key={u.id}
                  className="rounded-lg border border-hairline bg-panel p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <HealthBadge health={u.health} />
                    {u.stage ? <StageChip stage={u.stage} /> : null}
                    <span className="ms-auto">
                      <RelativeTime date={u.created_at} />
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium">{u.summary}</p>
                  {u.details ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                      {u.details}
                    </p>
                  ) : null}
                  <div className="mt-2 text-[11px] text-faint">
                    {t('detail.byAuthor', {
                      name:
                        (u.author_id && memberNames.get(u.author_id)) || '—'
                    })}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>{p.archived_at ? null : <StatusUpdateForm productId={p.id} />}</div>
      </div>

      <ProductTrendsPanel productId={p.id} locale={locale} />
    </section>
  );
}
