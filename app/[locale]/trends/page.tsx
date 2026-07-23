import {TrendingUp} from 'lucide-react';
import {getLocale, getTranslations} from 'next-intl/server';

import TrendCard from '@/components/trends/TrendCard';
import TrendsFilter from '@/components/trends/TrendsFilter';
import {
  toTrendCardData,
  type ProductTrendRow
} from '@/components/trends/types';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

const FEED_LIMIT = 50;

// Cross-product trend feed: non-dismissed product_trends joined with
// trend_items + product name, newest first, filterable by product/source.
export default async function TrendsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActiveMember();
  const locale = await getLocale();
  const t = await getTranslations('trends');

  const params = await searchParams;
  const productFilter =
    typeof params.product === 'string' && params.product ? params.product : null;
  const sourceFilter =
    typeof params.source === 'string' && params.source ? params.source : null;

  const insforge = await createInsForgeServerClient();

  const embed = sourceFilter ? 'trend_items!inner' : 'trend_items';
  let query = insforge.database
    .from('product_trends')
    .select(
      `product_id, trend_item_id, relevance_score, relevance_note, created_at, ` +
        `${embed}(title, summary, summary_ar, url, source_name, published_at, found_at), ` +
        `products(name)`
    )
    .is('dismissed_at', null)
    .order('created_at', {ascending: false})
    .limit(FEED_LIMIT);
  if (productFilter) query = query.eq('product_id', productFilter);
  if (sourceFilter) query = query.eq('trend_items.source_name', sourceFilter);

  const [{data: rows}, {data: products}, {data: sourceRows}] =
    await Promise.all([
      query,
      insforge.database
        .from('products')
        .select('id, name')
        .is('archived_at', null)
        .order('name', {ascending: true}),
      // Recent source names for the filter dropdown (deduped client-side).
      insforge.database
        .from('trend_items')
        .select('source_name')
        .order('found_at', {ascending: false})
        .limit(200)
    ]);

  const trends = ((rows ?? []) as unknown as ProductTrendRow[])
    .map(toTrendCardData)
    .filter((trend): trend is NonNullable<typeof trend> => trend != null);

  const productOptions = ((products ?? []) as {id: string; name: string}[])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const sourceOptions = [
    ...new Set(
      ((sourceRows ?? []) as {source_name: string | null}[])
        .map((row) => row.source_name)
        .filter((name): name is string => !!name)
    )
  ].sort((a, b) => a.localeCompare(b));

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>

      <TrendsFilter
        products={productOptions}
        sources={sourceOptions}
        currentProduct={productFilter}
        currentSource={sourceFilter}
      />

      {trends.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-24 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
            <TrendingUp className="h-5 w-5 text-accent" strokeWidth={1.5} />
          </span>
          <div className="text-sm font-medium">{t('empty.title')}</div>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {t('empty.body')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {trends.map((trend) => (
            <TrendCard
              key={`${trend.productId}:${trend.trendItemId}`}
              trend={trend}
              locale={locale}
              showProduct
            />
          ))}
        </div>
      )}
    </section>
  );
}
