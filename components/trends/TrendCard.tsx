import {ExternalLink} from 'lucide-react';
import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import {Link} from '@/i18n/navigation';
import DismissButton from './DismissButton';
import type {TrendCardData} from './types';

type Props = {
  trend: TrendCardData;
  locale: string;
  // Show the linked-product chip (cross-product feed) or hide it (panel
  // embedded on a product page, where the product is already implied).
  showProduct?: boolean;
};

// One linked trend item: external article link, locale-appropriate summary,
// source/time metadata, relevance meter, and a dismiss control.
export default function TrendCard({trend, locale, showProduct = false}: Props) {
  const t = useTranslations('trends');

  const summary =
    locale === 'ar' && trend.summaryAr ? trend.summaryAr : trend.summary;
  const timestamp = trend.publishedAt ?? trend.foundAt;
  const relevancePct =
    trend.relevanceScore != null ? Math.round(trend.relevanceScore * 100) : null;

  return (
    <article className="rounded-lg border border-hairline bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        {trend.url ? (
          <a
            href={trend.url}
            target="_blank"
            rel="noopener noreferrer"
            title={t('card.openArticle')}
            className="group inline-flex items-start gap-1.5 text-sm font-medium text-ink transition-colors hover:text-accent"
          >
            <span className="leading-snug">{trend.title}</span>
            <ExternalLink
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-colors group-hover:text-accent"
              strokeWidth={1.75}
            />
          </a>
        ) : (
          <h3 className="text-sm font-medium leading-snug">{trend.title}</h3>
        )}
        <DismissButton
          productId={trend.productId}
          trendItemId={trend.trendItemId}
        />
      </div>

      {summary ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">{summary}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {trend.sourceName ? (
          <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[11px] text-muted">
            {trend.sourceName}
          </span>
        ) : null}
        {timestamp ? <RelativeTime date={timestamp} /> : null}
        {showProduct && trend.productName ? (
          <Link
            href={`/products/${trend.productId}`}
            className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent/20"
          >
            {trend.productName}
          </Link>
        ) : null}
        {relevancePct != null ? (
          <span
            className="ms-auto flex items-center gap-1.5"
            title={t('card.relevance')}
          >
            <span className="h-1 w-12 overflow-hidden rounded-full bg-raised">
              <span
                className="block h-full bg-accent/70"
                style={{width: `${relevancePct}%`}}
              />
            </span>
            <span className="font-mono text-[11px] text-muted">
              {relevancePct}%
            </span>
          </span>
        ) : null}
      </div>

      {trend.relevanceNote ? (
        <p className="mt-2 border-s border-hairline ps-2 text-xs leading-relaxed text-faint">
          <span className="text-muted">{t('card.why')}:</span>{' '}
          {trend.relevanceNote}
        </p>
      ) : null}
    </article>
  );
}
