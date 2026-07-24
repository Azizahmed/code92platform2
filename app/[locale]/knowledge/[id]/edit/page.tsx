import {ChevronLeft} from 'lucide-react';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';

import KnowledgeForm, {
  type KnowledgeFormInitial
} from '@/components/knowledge/KnowledgeForm';
import {Link} from '@/i18n/navigation';
import type {KnowledgeItem, KnowledgeTag} from '@/lib/actions/knowledge';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export default async function EditKnowledgeItemPage({
  params
}: {
  params: Promise<{locale: string; id: string}>;
}) {
  const {id} = await params;
  const {user, member} = await requireActiveMember();
  const t = await getTranslations('knowledge');

  const insforge = await createInsForgeServerClient();
  const {data: row} = await insforge.database
    .from('knowledge_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!row) notFound();
  const item = row as unknown as KnowledgeItem;

  // RLS would reject the write anyway; failing here keeps a reader from
  // filling in a form that can never be saved.
  if (item.author_id !== user.id && member.role !== 'admin') notFound();

  const [{data: tagLinks}, {data: productLinks}, {data: tags}, {data: products}] =
    await Promise.all([
      insforge.database
        .from('knowledge_item_tags')
        .select('tag_id')
        .eq('item_id', id),
      insforge.database
        .from('knowledge_item_products')
        .select('product_id')
        .eq('item_id', id),
      insforge.database.from('tags').select('id, name').order('name'),
      insforge.database
        .from('products')
        .select('id, name')
        .is('archived_at', null)
        .order('name')
    ]);

  const initial: KnowledgeFormInitial = {
    kind: item.kind,
    title: item.title,
    content: item.content,
    url: item.url,
    status: item.status,
    tagIds: (tagLinks ?? []).map((link) => link.tag_id as string),
    productIds: (productLinks ?? []).map((link) => link.product_id as string),
    file:
      item.file_key && item.file_url && item.file_name
        ? {
            url: item.file_url,
            key: item.file_key,
            fileName: item.file_name,
            mimeType: item.mime_type ?? 'application/octet-stream',
            sizeBytes: item.size_bytes ?? 1
          }
        : null
  };

  return (
    <section className="space-y-6">
      <div>
        <Link
          href={`/knowledge/${item.id}`}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
          {t('backToItem')}
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-semibold">{t('edit.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('edit.subtitle')}</p>
      </header>

      <KnowledgeForm
        mode="edit"
        itemId={item.id}
        initial={initial}
        tags={(tags ?? []) as unknown as KnowledgeTag[]}
        products={(products ?? []) as unknown as {id: string; name: string}[]}
      />
    </section>
  );
}
