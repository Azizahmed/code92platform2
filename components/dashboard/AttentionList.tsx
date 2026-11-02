import {getTranslations} from 'next-intl/server';

import {Link} from '@/i18n/navigation';

export type AttentionRow = {
  kind: 'gate_pending' | 'release_overdue' | 'project_stale' | 'product_no_business_owner' | 'product_no_operator';
  record_id: string;
  title: string;
  detail: string | null;
  due_on: string | null;
};

const HREF: Record<AttentionRow['kind'], (id: string) => string> = {
  gate_pending: (id) => `/products/${id}?tab=business`,
  release_overdue: (id) => `/releases/${id}`,
  project_stale: (id) => `/projects/${id}`,
  product_no_business_owner: (id) => `/products/${id}?tab=business`,
  product_no_operator: (id) => `/products/${id}?tab=business`
};

// What is waiting on someone, team-wide. An empty list is the good state.
export default async function AttentionList({rows}: {rows: AttentionRow[]}) {
  const t = await getTranslations('dashboard');
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-4 py-6 text-center text-xs text-faint">{t('attention.empty')}</p>;
  }
  return (
    <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-panel">
      {rows.map((row) => (
        <li key={`${row.kind}-${row.record_id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <Link href={HREF[row.kind](row.record_id)} className="min-w-0 truncate text-sm text-ink hover:text-accent">
            {row.title}
          </Link>
          <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
            <span className="rounded border border-amber/25 bg-amber/5 px-1.5 py-0.5 text-amber">{t(`attention.kinds.${row.kind}`)}</span>
            {row.detail && row.kind !== 'product_no_business_owner' ? <span className="text-faint">{row.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
