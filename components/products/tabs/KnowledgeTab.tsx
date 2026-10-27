import {BookOpen, ChevronRight} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import KnowledgeLinkEditor from '@/components/products/KnowledgeLinkEditor';
import KindChip from '@/components/knowledge/KindChip';
import StatusChip from '@/components/knowledge/StatusChip';
import RelativeTime from '@/components/RelativeTime';
import {Link} from '@/i18n/navigation';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {KnowledgeKind, KnowledgeStatus} from '@/lib/knowledge';

type Track = 'business' | 'development' | 'all';

type LinkedRow = {
  track: 'business' | 'development' | null;
  release_id: string | null;
  knowledge_items: {
    id: string;
    kind: KnowledgeKind;
    title: string;
    status: KnowledgeStatus;
    archived_at: string | null;
    created_at: string;
  } | null;
};

// Everything from the knowledge base linked to this product, filtered by track and
// by release. The filters are query parameters, so a link lands on the same view.
export default async function KnowledgeTab({
  productId,
  track,
  releaseId
}: {
  productId: string;
  track: Track;
  releaseId: string | null;
}) {
  const t = await getTranslations('knowledge');
  const tb = await getTranslations('business');
  const insforge = await createInsForgeServerClient();

  const [{data: links}, {data: releases}] = await Promise.all([
    insforge.database
      .from('knowledge_item_products')
      .select('track, release_id, knowledge_items(id, kind, title, status, archived_at, created_at)')
      .eq('product_id', productId),
    insforge.database
      .from('release_overview')
      .select('id, version, release_number')
      .eq('product_id', productId)
      .order('release_number', {ascending: true})
  ]);

  const releaseOptions = (releases ?? []).map((row) => ({
    id: row.id as string,
    version: row.version as string
  }));

  const items = ((links ?? []) as unknown as LinkedRow[])
    .filter((row): row is LinkedRow & {knowledge_items: NonNullable<LinkedRow['knowledge_items']>} =>
      row.knowledge_items !== null && row.knowledge_items.archived_at === null
    )
    .filter((row) => (track === 'all' ? true : row.track === track))
    .filter((row) => (releaseId ? row.release_id === releaseId : true))
    .sort((a, b) => b.knowledge_items.created_at.localeCompare(a.knowledge_items.created_at));

  const filterHref = (next: {track?: Track; release?: string | null}) => {
    const params = new URLSearchParams();
    const nextTrack = next.track ?? track;
    const nextRelease = next.release === undefined ? releaseId : next.release;
    if (nextTrack !== 'all') params.set('track', nextTrack);
    if (nextRelease) params.set('release', nextRelease);
    const query = params.toString();
    return `?tab=knowledge${query ? `&${query}` : ''}`;
  };

  const tabs: Track[] = ['all', 'business', 'development'];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((option) => (
            <Link
              key={option}
              href={filterHref({track: option, release: option === 'business' ? null : releaseId})}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                track === option
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-hairline text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {tb(`knowledge.filter.${option}`)}
            </Link>
          ))}
        </div>
        {releaseOptions.length > 0 && track !== 'business' ? (
          <div className="flex flex-wrap gap-1.5">
            <Link
              href={filterHref({release: null})}
              className={`rounded-md border px-2 py-1 text-[11px] ${!releaseId ? 'border-accent/40 text-accent' : 'border-hairline text-muted'}`}
            >
              {tb('knowledge.allReleases')}
            </Link>
            {releaseOptions.map((release) => (
              <Link
                key={release.id}
                href={filterHref({track: 'development', release: release.id})}
                className={`rounded-md border px-2 py-1 font-mono text-[11px] ${releaseId === release.id ? 'border-accent/40 text-accent' : 'border-hairline text-muted'}`}
              >
                {release.version}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
            <BookOpen className="h-4 w-4 text-accent" strokeWidth={1.5} />
          </span>
          <div className="text-sm font-medium">{t('panel.emptyTitle')}</div>
          <p className="max-w-sm text-sm leading-relaxed text-muted">{t('panel.emptyBody')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((row) => (
            <li key={row.knowledge_items.id} className="space-y-2 rounded-lg border border-hairline bg-panel px-4 py-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <KindChip kind={row.knowledge_items.kind} />
                <StatusChip status={row.knowledge_items.status} />
                <Link href={`/knowledge/${row.knowledge_items.id}`} dir="auto" className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                  {row.knowledge_items.title}
                </Link>
                <RelativeTime date={row.knowledge_items.created_at} />
                <ChevronRight className="h-3.5 w-3.5 text-faint rtl:rotate-180" strokeWidth={2} />
              </div>
              <KnowledgeLinkEditor
                productId={productId}
                itemId={row.knowledge_items.id}
                track={row.track}
                releaseId={row.release_id}
                releases={releaseOptions}
                disabled={false}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
