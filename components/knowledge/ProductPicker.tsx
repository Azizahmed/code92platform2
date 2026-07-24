'use client';

import {useTranslations} from 'next-intl';

export type ProductOption = {id: string; name: string};

type Props = {
  products: ProductOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

// Links are optional and many-to-many: company-wide knowledge simply stays
// unlinked, and cross-product research can point at every product it touches.
export default function ProductPicker({
  products,
  selectedIds,
  onChange,
  disabled
}: Props) {
  const t = useTranslations('knowledge');

  if (products.length === 0) {
    return <p className="text-[11px] text-faint">{t('products.none')}</p>;
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-hairline bg-bg p-2">
      {products.map((product) => {
        const checked = selectedIds.includes(product.id);
        return (
          <label
            key={product.id}
            className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors hover:bg-raised"
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() =>
                onChange(
                  checked
                    ? selectedIds.filter((id) => id !== product.id)
                    : [...selectedIds, product.id]
                )
              }
              className="h-4 w-4 accent-accent"
            />
            <span className={checked ? 'text-ink' : 'text-muted'}>
              {product.name}
            </span>
          </label>
        );
      })}
    </div>
  );
}
