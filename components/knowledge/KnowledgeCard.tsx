import {ExternalLink, Paperclip} from 'lucide-react';
import {useTranslations} from 'next-intl';

import KindChip from '@/components/knowledge/KindChip';
import ProvenanceChip from '@/components/knowledge/ProvenanceChip';
import StatusChip from '@/components/knowledge/StatusChip';
import RelativeTime from '@/components/RelativeTime';
import {Link} from '@/i18n/navigation';
import type {KnowledgeSearchRow} from '@/lib/actions/knowledge';

export default function KnowledgeCard({item}: {item: KnowledgeSearchRow}) {
  const t = useTranslations('knowledge');

  return (
    <article className="rounded-lg border border-hairline bg-panel p-4 transition-colors hover:border-accent/30">
      <div className="flex flex-wrap items-center gap-2.5">
        <KindChip kind={item.kind} />
        <StatusChip status={item.status} />
        {item.archived_at ? (
          <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">
            {t('archivedTag')}
          </span>
        ) : null}
        <span className="ms-auto">
          <RelativeTime date={item.created_at} />
        </span>
      </div>

      <h2 className="mt-2.5 text-sm font-semibold">
        <Link
          href={`/knowledge/${item.id}`}
          dir="auto"
          className="transition-colors hover:text-accent"
        >
          {item.title}
        </Link>
      </h2>

      {item.excerpt ? (
        <p
          dir="auto"
          className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted"
        >
          {item.excerpt}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-faint">
        {item.author_name ? (
          <span>{t('byAuthor', {name: item.author_name})}</span>
        ) : null}
        {item.url ? (
          <span className="inline-flex items-center gap-1">
            <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            {t('hasLink')}
          </span>
        ) : null}
        {item.file_name ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3 w-3" strokeWidth={1.75} />
            {item.file_name}
          </span>
        ) : null}
      </div>

      {/* Provenance sits on its own line, above the tags: it answers a
          different question ("is this the governed document?") from the tags
          and product chips, and burying it among them loses it. */}
      {item.origin === 'lifecycle' &&
      item.source_product_id &&
      item.source_product_name &&
      item.source_phase &&
      item.source_artifact_type ? (
        <div className="mt-3">
          <ProvenanceChip
            productId={item.source_product_id}
            productName={item.source_product_name}
            phase={item.source_phase}
            artifactType={item.source_artifact_type}
          />
        </div>
      ) : null}

      {item.tag_names.length > 0 || item.product_names.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {item.tag_names.map((tag) => (
            <span
              key={tag}
              className="rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted"
            >
              {tag}
            </span>
          ))}
          {item.product_names.map((product) => (
            <span
              key={product}
              className="rounded border border-accent/25 bg-accent/5 px-1.5 py-0.5 font-mono text-[11px] text-accent"
            >
              {product}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
