import {useTranslations} from 'next-intl';

type Props = {
  products: {id: string; name: string}[];
  sources: string[];
  currentProduct: string | null;
  currentSource: string | null;
};

const selectClass =
  'rounded-md border border-hairline bg-raised px-2.5 py-1.5 text-sm text-ink focus:border-accent/50 focus:outline-none';

// Plain GET form (progressive enhancement): the selected filters land in the
// query string and the server component re-renders the feed.
export default function TrendsFilter({
  products,
  sources,
  currentProduct,
  currentSource
}: Props) {
  const t = useTranslations('trends');

  return (
    <form className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-widest text-faint">
          {t('filters.product')}
        </span>
        <select
          name="product"
          defaultValue={currentProduct ?? ''}
          className={selectClass}
        >
          <option value="">{t('filters.allProducts')}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-widest text-faint">
          {t('filters.source')}
        </span>
        <select
          name="source"
          defaultValue={currentSource ?? ''}
          className={selectClass}
        >
          <option value="">{t('filters.allSources')}</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="rounded-md border border-hairline bg-raised px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        {t('filters.apply')}
      </button>
    </form>
  );
}
