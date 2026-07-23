import {ChevronLeft} from 'lucide-react';
import {notFound} from 'next/navigation';
import {getLocale, getTranslations} from 'next-intl/server';

import ArchiveButton from '@/components/products/ArchiveButton';
import ProductForm, {
  type MemberOption,
  type ProductFormInitial
} from '@/components/products/ProductForm';
import {Link, redirect} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import type {Product} from '@/lib/actions/products';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export default async function EditProductPage({
  params
}: {
  params: Promise<{locale: string; id: string}>;
}) {
  const {id} = await params;
  const {user, member} = await requireActiveMember();
  const t = await getTranslations('products');

  const insforge = await createInsForgeServerClient();
  const [{data: product}, {data: members}] = await Promise.all([
    insforge.database.from('products').select('*').eq('id', id).maybeSingle(),
    insforge.database
      .from('team_members')
      .select('user_id, display_name')
      .eq('is_active', true)
      .order('display_name')
  ]);

  if (!product) notFound();

  const p = product as unknown as Product;
  const isAdmin = member.role === 'admin';

  // Owner or admin only — everyone else is bounced to the detail page.
  // RLS would reject the update anyway; this keeps the UI honest.
  if (p.owner_id !== user.id && !isAdmin) {
    redirect({href: `/products/${p.id}`, locale: await getLocale()});
  }

  const initial: ProductFormInitial = {
    name: p.name,
    slug: p.slug,
    description: p.description,
    descriptionAr: p.description_ar,
    category: p.category,
    stage: p.stage,
    keywords: p.keywords ?? [],
    links: p.links ?? {},
    reviewIntervalDays: p.review_interval_days,
    trendScanEnabled: p.trend_scan_enabled,
    ownerId: p.owner_id
  };

  const memberOptions: MemberOption[] = (members ?? []).map((m) => ({
    userId: m.user_id as string,
    displayName: m.display_name as string
  }));

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <Link
          href={`/products/${p.id}`}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
          {p.name}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t('edit.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('edit.subtitle')}</p>
      </div>

      {p.archived_at ? (
        <p className="rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber">
          {t('edit.archivedNotice')}
        </p>
      ) : null}

      <ProductForm
        mode="edit"
        productId={p.id}
        initial={initial}
        members={memberOptions}
        isAdmin={isAdmin}
      />

      {isAdmin ? (
        <ArchiveButton productId={p.id} archived={Boolean(p.archived_at)} />
      ) : null}
    </section>
  );
}
