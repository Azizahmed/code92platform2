import {Plus} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ProductsTable, {type ProductRow} from '@/components/products/ProductsTable';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {isBusinessStage, type BusinessStage} from '@/lib/business-track';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {isRiskTier} from '@/lib/risk';

export default async function ProductsPage({
  searchParams
}: {
  searchParams: Promise<{business_stage?: string}>;
}) {
  const {business_stage: stageParam} = await searchParams;
  const insforge = await createInsForgeServerClient();
  // product_overview carries the owner, the business stage and the current
  // release, so this is one round trip instead of several.
  const [, t, {data: products}] = await Promise.all([
    requireActiveMember(),
    getTranslations('products'),
    insforge.database
      .from('product_overview')
      .select(
        'id, name, slug, logo_url, health, owner_name, next_review_at, last_status_update_at, archived_at, risk_tier, business_stage, current_release_version, current_release_stage, checklist_done, checklist_total, created_at'
      )
      .order('created_at', {ascending: false})
  ]);

  const rows: ProductRow[] = (products ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    logoUrl: (p.logo_url as string | null) ?? null,
    health: p.health as ProductRow['health'],
    ownerName: (p.owner_name as string | null) ?? null,
    nextReviewAt: (p.next_review_at as string | null) ?? null,
    lastStatusUpdateAt: (p.last_status_update_at as string | null) ?? null,
    archivedAt: (p.archived_at as string | null) ?? null,
    riskTier: isRiskTier(p.risk_tier as string) ? (p.risk_tier as ProductRow['riskTier']) : 'medium',
    businessStage: isBusinessStage(p.business_stage as string) ? (p.business_stage as BusinessStage) : 'idea',
    currentReleaseVersion: (p.current_release_version as string | null) ?? null,
    currentReleaseStage: (p.current_release_stage as string | null) ?? null,
    checklistDone: (p.checklist_done as number | null) ?? 0,
    checklistTotal: (p.checklist_total as number | null) ?? 0
  }));

  const initialStage = isBusinessStage(stageParam ?? '') ? (stageParam as BusinessStage) : null;

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

      <ProductsTable products={rows} initialStage={initialStage} />
    </section>
  );
}
