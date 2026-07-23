import {Plus} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ProductsTable, {type ProductRow} from '@/components/products/ProductsTable';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export default async function ProductsPage() {
  await requireActiveMember();
  const t = await getTranslations('products');

  const insforge = await createInsForgeServerClient();
  const [{data: products}, {data: members}] = await Promise.all([
    insforge.database
      .from('products')
      .select(
        'id, name, slug, stage, health, owner_id, next_review_at, last_status_update_at, archived_at'
      )
      .order('created_at', {ascending: false}),
    insforge.database.from('team_members').select('user_id, display_name')
  ]);

  const ownerNames = new Map<string, string>(
    (members ?? []).map((m) => [m.user_id as string, m.display_name as string])
  );

  const rows: ProductRow[] = (products ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    stage: p.stage as ProductRow['stage'],
    health: p.health as ProductRow['health'],
    ownerName: ownerNames.get(p.owner_id as string) ?? null,
    nextReviewAt: (p.next_review_at as string | null) ?? null,
    lastStatusUpdateAt: (p.last_status_update_at as string | null) ?? null,
    archivedAt: (p.archived_at as string | null) ?? null
  }));

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t('list.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('list.subtitle')}</p>
        </div>
        <Link
          href="/products/new"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          {t('list.newProduct')}
        </Link>
      </header>

      <ProductsTable products={rows} />
    </section>
  );
}
