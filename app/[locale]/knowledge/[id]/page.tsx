import {ChevronLeft, ExternalLink, Package, Pencil} from 'lucide-react';
import {notFound} from 'next/navigation';
import {getFormatter, getTranslations} from 'next-intl/server';

import KindChip from '@/components/knowledge/KindChip';
import KnowledgeItemActions from '@/components/knowledge/KnowledgeItemActions';
import Markdown from '@/components/knowledge/Markdown';
import SourceFileLink from '@/components/knowledge/SourceFileLink';
import StatusChip from '@/components/knowledge/StatusChip';
import RelativeTime from '@/components/RelativeTime';
import {Link} from '@/i18n/navigation';
import type {KnowledgeItem} from '@/lib/actions/knowledge';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

type TagLink = {tags: {name: string} | null};
type ProductLink = {products: {id: string; name: string} | null};

export default async function KnowledgeItemPage({
  params
}: {
  params: Promise<{locale: string; id: string}>;
}) {
  const {id} = await params;
  const {user, member} = await requireActiveMember();
  const [t, format] = await Promise.all([
    getTranslations('knowledge'),
    getFormatter()
  ]);

  const insforge = await createInsForgeServerClient();
  const {data: row} = await insforge.database
    .from('knowledge_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!row) notFound();
  const item = row as unknown as KnowledgeItem;

  const [{data: tagLinks}, {data: productLinks}, {data: author}] =
    await Promise.all([
      insforge.database
        .from('knowledge_item_tags')
        .select('tags(name)')
        .eq('item_id', id),
      insforge.database
        .from('knowledge_item_products')
        .select('products(id, name)')
        .eq('item_id', id),
      insforge.database
        .from('team_members')
        .select('display_name')
        .eq('user_id', item.author_id)
        .maybeSingle()
    ]);

  const tagNames = ((tagLinks ?? []) as unknown as TagLink[])
    .map((link) => link.tags?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));

  const linkedProducts = ((productLinks ?? []) as unknown as ProductLink[])
    .map((link) => link.products)
    .filter((product): product is {id: string; name: string} => product != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const canEdit = item.author_id === user.id || member.role === 'admin';

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

      <header className="rounded-lg border border-hairline bg-panel p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <KindChip kind={item.kind} />
              <StatusChip status={item.status} />
              {item.archived_at ? (
                <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                  {t('archivedTag')}
                </span>
              ) : null}
            </div>
            <h1 dir="auto" className="text-xl font-semibold">
              {item.title}
            </h1>
          </div>
          {canEdit ? (
            <Link
              href={`/knowledge/${item.id}/edit`}
              className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Pencil className="h-4 w-4" strokeWidth={1.75} />
              {t('edit.action')}
            </Link>
          ) : null}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-hairline pt-5 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.author')}
            </dt>
            <dd className="mt-1 text-sm">
              {(author?.display_name as string | undefined) ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.created')}
            </dt>
            <dd className="mt-1 font-mono text-xs text-muted">
              {format.dateTime(new Date(item.created_at), {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.updated')}
            </dt>
            <dd className="mt-1">
              <RelativeTime date={item.updated_at} />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.tags')}
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {tagNames.length === 0 ? (
                <span className="text-sm text-faint">—</span>
              ) : (
                tagNames.map((name) => (
                  <span
                    key={name}
                    className="rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted"
                  >
                    {name}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </header>

      {item.url || item.file_key ? (
        <div className="space-y-3 rounded-lg border border-hairline bg-panel p-4 sm:p-6">
          <h2 className="text-sm font-medium">{t('detail.sourceTitle')}</h2>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              dir="ltr"
              className="inline-flex max-w-full items-center gap-2 break-all font-mono text-xs text-accent hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              {item.url}
            </a>
          ) : null}
          {item.file_key && item.file_name ? (
            <SourceFileLink
              itemId={item.id}
              fileName={item.file_name}
              sizeBytes={item.size_bytes}
            />
          ) : null}
        </div>
      ) : null}

      {item.content ? (
        <div className="rounded-lg border border-hairline bg-panel p-4 sm:p-6">
          <Markdown content={item.content} />
        </div>
      ) : null}

      {linkedProducts.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-hairline bg-panel p-4 sm:p-6">
          <h2 className="text-sm font-medium">{t('detail.productsTitle')}</h2>
          <div className="flex flex-wrap gap-2">
            {linkedProducts.map((product) => (
              <Link
                key={product.id}
                href={`/products/${product.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-raised px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink"
              >
                <Package className="h-3.5 w-3.5" strokeWidth={1.75} />
                {product.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <KnowledgeItemActions
          itemId={item.id}
          archived={Boolean(item.archived_at)}
        />
      ) : null}
    </section>
  );
}
