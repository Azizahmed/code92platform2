import {BookOpen, ChevronRight} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import KindChip from '@/components/knowledge/KindChip';
import StatusChip from '@/components/knowledge/StatusChip';
import RelativeTime from '@/components/RelativeTime';
import {Link} from '@/i18n/navigation';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {KnowledgeKind, KnowledgeStatus} from '@/lib/knowledge';

const PANEL_LIMIT = 8;

type LinkedItem = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  status: KnowledgeStatus;
  archived_at: string | null;
  created_at: string;
};

// Everything from the knowledge base that has been linked to this product.
// Archived items are hidden here; the full list is one click away.
export default async function ProductKnowledgePanel({
  productId
}: {
  productId: string;
}) {
  const t = await getTranslations('knowledge');

  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('knowledge_item_products')
    .select('knowledge_items(id, kind, title, status, archived_at, created_at)')
    .eq('product_id', productId);

  const items = ((data ?? []) as unknown as {
    knowledge_items: LinkedItem | null;
  }[])
    .map((row) => row.knowledge_items)
    .filter((item): item is LinkedItem => item != null && !item.archived_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t('panel.title')}</h2>
        <Link
          href={`/knowledge?product=${productId}`}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
        >
          {t('panel.viewAll')}
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
            <BookOpen className="h-4 w-4 text-accent" strokeWidth={1.5} />
          </span>
          <div className="text-sm font-medium">{t('panel.emptyTitle')}</div>
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            {t('panel.emptyBody')}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, PANEL_LIMIT).map((item) => (
            <li key={item.id}>
              <Link
                href={`/knowledge/${item.id}`}
                className="flex flex-wrap items-center gap-2.5 rounded-lg border border-hairline bg-panel px-4 py-3 transition-colors hover:border-accent/30"
              >
                <KindChip kind={item.kind} />
                <StatusChip status={item.status} />
                <span dir="auto" className="min-w-0 flex-1 truncate text-sm">
                  {item.title}
                </span>
                <RelativeTime date={item.created_at} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {items.length > PANEL_LIMIT ? (
        <p className="text-[11px] text-faint">
          {t('panel.more', {count: items.length - PANEL_LIMIT})}
        </p>
      ) : null}
    </section>
  );
}
