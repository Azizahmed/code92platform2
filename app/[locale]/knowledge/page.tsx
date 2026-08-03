import {BookOpen, Plus} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import KnowledgeCard from '@/components/knowledge/KnowledgeCard';
import KnowledgeFilters from '@/components/knowledge/KnowledgeFilters';
import {Link} from '@/i18n/navigation';
import type {KnowledgeSearchRow} from '@/lib/actions/knowledge';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_ORIGINS,
  KNOWLEDGE_STATUSES
} from '@/lib/knowledge';
import {LIFECYCLE_PHASES} from '@/lib/lifecycle';

const RESULT_LIMIT = 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function readUuid(params: SearchParams, key: string): string | null {
  const value = readParam(params, key);
  return value && UUID_PATTERN.test(value) ? value : null;
}

function readOneOf(
  params: SearchParams,
  key: string,
  allowed: readonly string[]
): string | null {
  const value = readParam(params, key);
  return value && allowed.includes(value) ? value : null;
}

// The whole list — filters and ranked full-text search — comes from the
// search_knowledge_items RPC, which runs with the caller's own RLS context.
export default async function KnowledgePage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireActiveMember();
  const t = await getTranslations('knowledge');
  const params = await searchParams;

  const query = readParam(params, 'q') ?? '';
  const kind = readOneOf(params, 'kind', KNOWLEDGE_KINDS);
  const status = readOneOf(params, 'status', KNOWLEDGE_STATUSES);
  const tag = readUuid(params, 'tag');
  const product = readUuid(params, 'product');
  const phase = readOneOf(params, 'phase', LIFECYCLE_PHASES);
  // A phase filter only ever matches lifecycle-derived items, so asking for one
  // implies the other. Making that implicit keeps "Requirements" from silently
  // returning nothing while Origin still says "All".
  const origin = phase
    ? 'lifecycle'
    : readOneOf(params, 'origin', KNOWLEDGE_ORIGINS);
  const includeArchived = readParam(params, 'archived') === '1';

  const insforge = await createInsForgeServerClient();
  const [{data: rows}, {data: tags}, {data: products}] = await Promise.all([
    insforge.database.rpc('search_knowledge_items', {
      p_query: query || null,
      p_kind: kind,
      p_status: status,
      p_tag: tag,
      p_product: product,
      p_include_archived: includeArchived,
      p_limit: RESULT_LIMIT,
      p_origin: origin,
      p_phase: phase
    }),
    insforge.database.from('tags').select('id, name').order('name'),
    insforge.database
      .from('products')
      .select('id, name')
      .is('archived_at', null)
      .order('name')
  ]);

  const items = (rows ?? []) as unknown as KnowledgeSearchRow[];
  const tagOptions = ((tags ?? []) as {id: string; name: string}[]).map(
    (row) => ({id: row.id, name: row.name})
  );
  const productOptions = ((products ?? []) as {id: string; name: string}[]).map(
    (row) => ({id: row.id, name: row.name})
  );
  const filtered =
    Boolean(query) ||
    kind ||
    status ||
    tag ||
    product ||
    origin ||
    phase ||
    includeArchived;

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Link
          href="/knowledge/new"
          className="inline-flex w-fit items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          {t('newItem')}
        </Link>
      </header>

      <KnowledgeFilters
        tags={tagOptions}
        products={productOptions}
        current={{query, kind, status, tag, product, origin, phase, includeArchived}}
      />

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-24 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
            <BookOpen className="h-5 w-5 text-accent" strokeWidth={1.5} />
          </span>
          <div className="text-sm font-medium">
            {filtered ? t('empty.filteredTitle') : t('empty.title')}
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {filtered ? t('empty.filteredBody') : t('empty.body')}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] uppercase tracking-widest text-faint">
            {t('resultCount', {count: items.length})}
          </p>
          <div className="space-y-3">
            {items.map((item) => (
              <KnowledgeCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
