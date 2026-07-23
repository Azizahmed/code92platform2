// Shared row types for product_trends queries with embedded trend_items
// (and, for the cross-product feed, the linked product name).

export type TrendItemRow = {
  title: string | null;
  summary: string | null;
  summary_ar: string | null;
  url: string | null;
  source_name: string | null;
  published_at: string | null;
  found_at: string | null;
};

export type ProductTrendRow = {
  product_id: string;
  trend_item_id: string;
  relevance_score: number | null;
  relevance_note: string | null;
  trend_items: TrendItemRow | TrendItemRow[] | null;
  products?: {name: string} | {name: string}[] | null;
};

export type TrendCardData = {
  productId: string;
  trendItemId: string;
  relevanceScore: number | null;
  relevanceNote: string | null;
  productName: string | null;
  title: string;
  summary: string | null;
  summaryAr: string | null;
  url: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  foundAt: string | null;
};

// PostgREST returns many-to-one embeds as an object, but tolerate arrays so
// callers don't care about the exact shape. Rows without an item are dropped.
export function toTrendCardData(row: ProductTrendRow): TrendCardData | null {
  const item = Array.isArray(row.trend_items)
    ? row.trend_items[0]
    : row.trend_items;
  if (!item) return null;

  const product = Array.isArray(row.products) ? row.products[0] : row.products;

  return {
    productId: row.product_id,
    trendItemId: row.trend_item_id,
    relevanceScore: row.relevance_score ?? null,
    relevanceNote: row.relevance_note ?? null,
    productName: product?.name ?? null,
    title: item.title ?? '',
    summary: item.summary ?? null,
    summaryAr: item.summary_ar ?? null,
    url: item.url ?? null,
    sourceName: item.source_name ?? null,
    publishedAt: item.published_at ?? null,
    foundAt: item.found_at ?? null
  };
}
