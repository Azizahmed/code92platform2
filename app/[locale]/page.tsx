import {AlertTriangle, Plus, Radar} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ProductCard from '@/components/dashboard/ProductCard';
import Reveal from '@/components/dashboard/Reveal';
import StatsStrip from '@/components/dashboard/StatsStrip';
import type {ProductOverview} from '@/components/dashboard/types';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

// Overdue first; within a group, earliest review date first (nulls last).
function sortProducts(rows: ProductOverview[]): ProductOverview[] {
  return [...rows].sort((a, b) => {
    const overdueDelta = Number(b.is_overdue) - Number(a.is_overdue);
    if (overdueDelta !== 0) return overdueDelta;
    const aTime = a.next_review_at ? Date.parse(a.next_review_at) : Infinity;
    const bTime = b.next_review_at ? Date.parse(b.next_review_at) : Infinity;
    return aTime - bTime;
  });
}

export default async function DashboardPage() {
  await requireActiveMember();
  const t = await getTranslations('dashboard');

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_overview')
    .select('*')
    .is('archived_at', null);

  if (error) {
    console.error('dashboard product_overview query failed', error);
    return (
      <section className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </header>
        <div className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 px-5 py-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger" strokeWidth={1.75} />
          <div>
            <div className="text-sm font-medium">{t('error.title')}</div>
            <p className="mt-0.5 text-xs text-muted">{t('error.body')}</p>
          </div>
        </div>
      </section>
    );
  }

  const products = sortProducts((data ?? []) as ProductOverview[]);

  const stats = products.reduce(
    (acc, p) => {
      acc.total += 1;
      if (p.is_overdue) acc.overdue += 1;
      acc[p.health] = (acc[p.health] ?? 0) + 1;
      acc.trends += p.trend_count_7d ?? 0;
      return acc;
    },
    {total: 0, overdue: 0, green: 0, yellow: 0, red: 0, unknown: 0, trends: 0}
  );

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>

      {products.length === 0 ? (
        <Reveal>
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-24 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10">
              <Radar className="h-5 w-5 text-accent" strokeWidth={1.5} />
            </span>
            <div className="text-sm font-medium">{t('empty.title')}</div>
            <p className="max-w-md text-sm leading-relaxed text-muted">
              {t('empty.body')}
            </p>
            <Link
              href="/products/new"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4 rtl:rotate-180" strokeWidth={2} />
              {t('empty.cta')}
            </Link>
          </div>
        </Reveal>
      ) : (
        <>
          <Reveal index={0}>
            <StatsStrip
              total={stats.total}
              overdue={stats.overdue}
              green={stats.green}
              yellow={stats.yellow}
              red={stats.red}
              unknown={stats.unknown}
              trends={stats.trends}
            />
          </Reveal>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {products.map((product, index) => (
              <Reveal key={product.id} index={index + 1} className="h-full">
                <ProductCard product={product} />
              </Reveal>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
