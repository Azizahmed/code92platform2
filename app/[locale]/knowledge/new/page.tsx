import {ChevronLeft} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import KnowledgeForm from '@/components/knowledge/KnowledgeForm';
import {Link} from '@/i18n/navigation';
import type {KnowledgeTag} from '@/lib/actions/knowledge';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export default async function NewKnowledgeItemPage() {
  await requireActiveMember();
  const t = await getTranslations('knowledge');

  const insforge = await createInsForgeServerClient();
  const [{data: tags}, {data: products}] = await Promise.all([
    insforge.database.from('tags').select('id, name').order('name'),
    insforge.database
      .from('products')
      .select('id, name')
      .is('archived_at', null)
      .order('name')
  ]);

  return (
    <section className="space-y-6">
      <div>
        <Link
          href="/knowledge"
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
          {t('backToList')}
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-semibold">{t('new.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('new.subtitle')}</p>
      </header>

      <KnowledgeForm
        mode="create"
        tags={(tags ?? []) as unknown as KnowledgeTag[]}
        products={(products ?? []) as unknown as {id: string; name: string}[]}
      />
    </section>
  );
}
