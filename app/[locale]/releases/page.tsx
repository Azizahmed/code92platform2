import {Rocket} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ReleasesBoard from '@/components/releases/ReleasesBoard';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {ReleaseOverview} from '@/lib/releases';

// The cycle board: every release across every product in one place, because
// the question people actually ask is "what is going out this fortnight",
// which no single product page can answer.
export default async function ReleasesPage({
  params
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  const {user, member} = await requireActiveMember();
  const t = await getTranslations('releases');
  const insforge = await createInsForgeServerClient();

  const [{data: releases}, {data: products}, {data: members}] =
    await Promise.all([
      insforge.database
        .from('release_overview')
        .select('*')
        .order('target_date', {ascending: true, nullsFirst: false})
        .order('created_at', {ascending: false}),
      insforge.database
        .from('products')
        .select('id, name, owner_id, archived_at')
        .is('archived_at', null)
        .order('name'),
      insforge.database
        .from('team_members')
        .select('user_id, display_name')
        .eq('is_active', true)
        .order('display_name')
    ]);

  const isAdmin = member.role === 'admin';

  // Only products this person could actually create a release on: the owner or
  // an admin, mirroring can_manage_release_for_product(). Offering the rest in
  // the picker would produce a form that fails on submit.
  const productOptions = (products ?? [])
    .filter((product) => isAdmin || product.owner_id === user.id)
    .map((product) => ({
      id: product.id as string,
      name: product.name as string
    }));

  const memberOptions = (members ?? []).map((row) => ({
    userId: row.user_id as string,
    displayName: row.display_name as string
  }));

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
        members={memberOptions}
        locale={locale}
        canCreate={productOptions.length > 0}
      />
    </section>
  );
}
