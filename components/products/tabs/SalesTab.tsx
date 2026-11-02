import {getTranslations} from 'next-intl/server';

import DealsTable from '@/components/sales/DealsTable';
import {Link} from '@/i18n/navigation';
import {businessDate} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {DealRow} from '@/lib/sales/types';

// The deals and accounts that touch this product: product deals for it, and the
// accounts that are its customers.
export default async function SalesTab({
  productId,
  locale
}: {
  productId: string;
  locale: string;
}) {
  const t = await getTranslations('business');
  const insforge = await createInsForgeServerClient();
  const [{data: deals}, {data: customers}] = await Promise.all([
    insforge.database
      .from('deal_overview')
      .select('*')
      .eq('product_id', productId)
      .order('updated_at', {ascending: false}),
    insforge.database
      .from('account_products')
      .select('account_id, accounts(name)')
      .eq('product_id', productId)
  ]);

  const customerRows = ((customers ?? []) as unknown as {
    account_id: string;
    accounts: {name: string} | null;
  }[]);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{t('sales.deals')}</h2>
          <Link href="/sales/deals/new" className="text-xs text-accent hover:underline">
            {t('sales.newDeal')}
          </Link>
        </div>
        <DealsTable
          deals={(deals ?? []) as unknown as DealRow[]}
          today={businessDate()}
          locale={locale}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('sales.customers')}</h2>
        {customerRows.length === 0 ? (
          <p className="text-xs text-faint">{t('sales.noCustomers')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-xs">
            {customerRows.map((row) => (
              <li key={row.account_id}>
                <Link
                  href={`/sales/accounts/${row.account_id}`}
                  className="inline-flex rounded-md border border-hairline px-2.5 py-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  {row.accounts?.name ?? '—'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
