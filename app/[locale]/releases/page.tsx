import {Rocket} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ReleasesBoard from '@/components/releases/ReleasesBoard';
import {requireActiveMember} from '@/lib/auth';
import {businessDate} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {ReleaseOverview} from '@/lib/releases';

// The release board: every release across every product, by stage. The question
// people ask is what is in design and what is going out, which no single product
// page answers.
export default async function ReleasesPage({
  params
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  const {user, member} = await requireActiveMember();
  const t = await getTranslations('releases');
  const insforge = await createInsForgeServerClient();

  const [{data: releases}, {data: products}] = await Promise.all([
    insforge.database
      .from('release_overview')
      .select('*')
      .order('target_date', {ascending: true, nullsFirst: false})
      .order('created_at', {ascending: false}),
    insforge.database.from('products').select('id, name, owner_id, business_stage, archived_at').is('archived_at', null).order('name')
  ]);

  const isAdmin = member.role === 'admin';
  // A cycle needs the product past Gate 1, and the owner or an admin to create it.
  // Offering the others would produce a form that fails on submit.
  const productOptions = (products ?? [])
    .filter((product) => (isAdmin || product.owner_id === user.id) && ['build', 'venture', 'company', 'board'].includes(product.business_stage as string))
    .map((product) => ({id: product.id as string, name: product.name as string}));

  return (
    <section className="space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>

      <ReleasesBoard
        releases={(releases ?? []) as unknown as ReleaseOverview[]}
        products={productOptions}
        locale={locale}
        canCreate={productOptions.length > 0}
        defaultTargetDate={businessDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 30))}
      />
    </section>
  );
}
