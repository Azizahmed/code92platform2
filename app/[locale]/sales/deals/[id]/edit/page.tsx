import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';

import DealForm from '@/components/sales/DealForm';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {getActiveMembers, getActiveProducts} from '@/lib/sales/queries';
import type {DealSource, DealStage, DealType} from '@/lib/sales/stages';

export default async function EditDealPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  await requireActiveMember();
  const t = await getTranslations('sales');
  const insforge = await createInsForgeServerClient();

  const [{data: deal}, members, products] = await Promise.all([
    insforge.database
      .from('deal_overview')
      .select('id, account_id, account_name, name, type, product_id, product_name, owner_id, stage, value_amount, currency, expected_close, next_action, next_action_date, source')
      .eq('id', id)
      .maybeSingle(),
    getActiveMembers(),
    getActiveProducts()
  ]);
  if (!deal) notFound();

  // A deal may point at a product that was archived since; keep it selectable.
  const productOptions =
    deal.product_id && !products.some((product) => product.id === deal.product_id)
      ? [...products, {id: deal.product_id as string, name: deal.product_name as string}]
      : products;

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('editDealTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{deal.name as string}</p>
      </header>
      <DealForm
        mode="edit"
        dealId={id}
        initial={{
          accountId: deal.account_id as string,
          name: deal.name as string,
          type: deal.type as DealType,
          productId: (deal.product_id as string | null) ?? '',
          ownerId: deal.owner_id as string,
          stage: deal.stage as DealStage,
          valueAmount: deal.value_amount === null ? '' : String(deal.value_amount),
          currency: deal.currency as string,
          expectedClose: (deal.expected_close as string | null) ?? '',
          nextAction: (deal.next_action as string | null) ?? '',
          nextActionDate: (deal.next_action_date as string | null) ?? '',
          source: (deal.source as DealSource | null) ?? ''
        }}
        accounts={[{id: deal.account_id as string, name: deal.account_name as string}]}
        contacts={[]}
        members={members}
        products={productOptions}
      />
    </section>
  );
}
