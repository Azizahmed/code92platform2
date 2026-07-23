import {getTranslations} from 'next-intl/server';

import PlaceholderSection from '@/components/PlaceholderSection';
import {requireActiveMember} from '@/lib/auth';

export default async function ProductsPage() {
  await requireActiveMember();
  const t = await getTranslations('common');

  return <PlaceholderSection title={t('nav.products')} />;
}
