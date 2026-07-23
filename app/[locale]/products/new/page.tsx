import {ChevronLeft} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ProductForm from '@/components/products/ProductForm';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';

export default async function NewProductPage() {
  const {member} = await requireActiveMember();
  const t = await getTranslations('products');

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/products"
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
          {t('detail.back')}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t('new.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('new.subtitle')}</p>
      </div>

      <ProductForm
        mode="create"
        members={[]}
        isAdmin={member.role === 'admin'}
      />
    </section>
  );
}
