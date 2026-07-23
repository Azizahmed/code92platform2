import {getTranslations} from 'next-intl/server';

import {createInsForgeServerClient} from '@/lib/insforge/server';
import TrendCard from './TrendCard';
import {toTrendCardData, type ProductTrendRow} from './types';

const PANEL_LIMIT = 10;

// Linked market trends for one product: non-dismissed product_trends joined
// with trend_items, newest link first, with per-item dismiss. Self-fetching
// server component embedded on the product detail page.
export async function ProductTrendsPanel({
  productId,
  locale
}: {
  productId: string;
  locale: string;
}) {
  const t = await getTranslations({locale, namespace: 'trends'});

  const insforge = await createInsForgeServerClient();
  const {data: rows} = await insforge.database
    .from('product_trends')
    .select(
      'product_id, trend_item_id, relevance_score, relevance_note, created_at, ' +
        'trend_items(title, summary, summary_ar, url, source_name, published_at, found_at)'
    )
    .eq('product_id', productId)
    .is('dismissed_at', null)
    .order('created_at', {ascending: false})
    .limit(PANEL_LIMIT);

  const trends = ((rows ?? []) as unknown as ProductTrendRow[])
    .map(toTrendCardData)
    .filter((trend): trend is NonNullable<typeof trend> => trend != null);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium">{t('panel.title')}</h2>
      {trends.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center">
          <div className="text-sm font-medium">{t('panel.emptyTitle')}</div>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            {t('panel.emptyBody')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {trends.map((trend) => (
            <TrendCard
              key={`${trend.productId}:${trend.trendItemId}`}
              trend={trend}
              locale={locale}
            />
          ))}
        </div>
      )}
    </section>
  );
}
