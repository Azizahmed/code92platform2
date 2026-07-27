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
  // product_overview already joins the owner name and carries the lifecycle
  // columns, so this is one round trip instead of products + team_members.
  const {data: products} = await insforge.database
    .from('product_overview')
    .select(
      'id, name, slug, logo_url, stage, health, owner_name, next_review_at, last_status_update_at, archived_at, risk_tier, lifecycle_phase, lifecycle_state, lifecycle_complete_count, created_at'
    )
    .order('created_at', {ascending: false});

  const rows: ProductRow[] = (products ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    logoUrl: (p.logo_url as string | null) ?? null,
    stage: p.stage as ProductRow['stage'],
    health: p.health as ProductRow['health'],
    ownerName: (p.owner_name as string | null) ?? null,
    nextReviewAt: (p.next_review_at as string | null) ?? null,
    lastStatusUpdateAt: (p.last_status_update_at as string | null) ?? null,
    archivedAt: (p.archived_at as string | null) ?? null,
    riskTier: p.risk_tier as ProductRow['riskTier'],
    lifecyclePhase: (p.lifecycle_phase as ProductRow['lifecyclePhase']) ?? null,
    lifecycleState: (p.lifecycle_state as ProductRow['lifecycleState']) ?? null,
    lifecycleCompleteCount: (p.lifecycle_complete_count as number | null) ?? 0
  }));

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('list.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('list.subtitle')}</p>
        </div>
        <Link
          href="/products/new"
          className="inline-flex w-fit items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          {t('list.newProduct')}
        </Link>
      </header>

      <ProductsTable products={rows} />
    </section>
  );
}
