import {Search} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {SOURCE_STATUSES, WRITING_STATUSES, KNOWLEDGE_KINDS} from '@/lib/knowledge';

type Props = {
  tags: {id: string; name: string}[];
  products: {id: string; name: string}[];
  current: {
    query: string;
    kind: string | null;
    status: string | null;
    tag: string | null;
    product: string | null;
    includeArchived: boolean;
  };
};

const CONTROL_CLASS =
  'rounded-md border border-hairline bg-raised px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent/50';

// Plain GET form (progressive enhancement): filters land in the query string
// and the server component re-runs search_knowledge_items.
export default function KnowledgeFilters({tags, products, current}: Props) {
  const t = useTranslations('knowledge');

  return (
    <form className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
        <span className="text-[11px] uppercase tracking-widest text-faint">
          {t('filters.search')}
        </span>
        <span className="relative flex items-center">
          <Search
            className="pointer-events-none absolute start-2.5 h-4 w-4 text-faint"
            strokeWidth={1.75}
          />
          <input
            type="search"
            name="q"
            defaultValue={current.query}
            placeholder={t('filters.searchPlaceholder')}
            className={`${CONTROL_CLASS} w-full ps-8`}
          />
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-widest text-faint">
          {t('filters.kind')}
        </span>
        <select
          name="kind"
          defaultValue={current.kind ?? ''}
          className={CONTROL_CLASS}
        >
          <option value="">{t('filters.allKinds')}</option>
          {KNOWLEDGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-widest text-faint">
          {t('filters.status')}
        </span>
        <select
          name="status"
          defaultValue={current.status ?? ''}
          className={CONTROL_CLASS}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {/* Grouped because each kind owns its own status vocabulary. */}
          <optgroup label={t('filters.writingGroup')}>
            {WRITING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('filters.sourceGroup')}>
            {SOURCE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-widest text-faint">
          {t('filters.tag')}
        </span>
        <select
          name="tag"
          defaultValue={current.tag ?? ''}
          className={CONTROL_CLASS}
        >
          <option value="">{t('filters.allTags')}</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-widest text-faint">
          {t('filters.product')}
        </span>
        <select
          name="product"
          defaultValue={current.product ?? ''}
          className={CONTROL_CLASS}
        >
          <option value="">{t('filters.allProducts')}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 pb-2">
        <input
          type="checkbox"
          name="archived"
          value="1"
          defaultChecked={current.includeArchived}
          className="h-4 w-4 accent-accent"
        />
        <span className="text-sm text-muted">{t('filters.includeArchived')}</span>
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
