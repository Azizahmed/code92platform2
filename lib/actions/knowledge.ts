'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  KNOWLEDGE_FILE_BUCKET,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_STATUSES,
  MAX_KNOWLEDGE_FILE_BYTES,
  SIGNED_FILE_URL_TTL_SECONDS,
  isStatusForKind,
  type KnowledgeFileBucket,
  type KnowledgeKind,
  type KnowledgeOrigin,
  type KnowledgeStatus
} from '@/lib/knowledge';
import type {LifecyclePhase} from '@/lib/lifecycle';

type ServerClient = Awaited<ReturnType<typeof createInsForgeServerClient>>;

export type KnowledgeItem = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  content: string | null;
  url: string | null;
  file_url: string | null;
  file_key: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: KnowledgeStatus;
  author_id: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  origin: KnowledgeOrigin;
  // Set only when origin is 'lifecycle'. The database keeps the two in step
  // via the knowledge_items_origin_matches_source constraint.
  source_artifact_id: string | null;
  file_bucket: KnowledgeFileBucket;
};

// Where a lifecycle-derived item came from, one row per item, from the
// knowledge_provenance view.
export type KnowledgeProvenance = {
  item_id: string;
  artifact_id: string;
  artifact_type: string;
  generated_by: 'human' | 'agent';
  phase_id: string;
  phase: LifecyclePhase;
  cycle: number;
  phase_state: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  risk_tier: string;
  uploader_id: string;
  uploader_name: string | null;
  filed_at: string;
};

// One row of the search_knowledge_items RPC — the list view's only read path.
export type KnowledgeSearchRow = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  excerpt: string;
  url: string | null;
  file_name: string | null;
  status: KnowledgeStatus;
  author_id: string;
  author_name: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  rank: number;
  tag_names: string[];
  product_names: string[];
  origin: KnowledgeOrigin;
  source_artifact_id: string | null;
  // The four below are non-null exactly when origin is 'lifecycle'. Carried in
  // the search row so the list can show provenance without a second query per
  // card.
  source_artifact_type: string | null;
  source_phase: LifecyclePhase | null;
  source_product_id: string | null;
  source_product_name: string | null;
};

export type KnowledgeTag = {id: string; name: string};

export type KnowledgeActionResult =
  | {ok: true; itemId: string; previousFileKey?: string | null}
  | {ok: false; error: string};

export type TagActionResult =
  | {ok: true; tag: KnowledgeTag}
  | {ok: false; error: string};

export type SignedFileResult = {ok: true; url: string} | {ok: false; error: string};

const storedFileSchema = z.object({
  url: z.string().url().max(2000),
  key: z.string().trim().min(1).max(1000),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_KNOWLEDGE_FILE_BYTES)
});

const knowledgeInputSchema = z
  .object({
    kind: z.enum(KNOWLEDGE_KINDS),
    title: z.string().trim().min(1).max(240),
    content: z.string().trim().max(100000).nullable(),
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .regex(/^https?:\/\//)
      .nullable(),
    status: z.enum(KNOWLEDGE_STATUSES),
    tagIds: z.array(z.string().uuid()).max(30),
    productIds: z.array(z.string().uuid()).max(30),
    file: storedFileSchema.nullable()
  })
  // Same rules the database enforces, checked here so the UI gets a usable
  // message instead of a constraint violation.
  .refine((value) => isStatusForKind(value.kind, value.status))
  .refine((value) =>
    value.kind === 'source'
      ? Boolean(value.url) || value.file !== null
      : Boolean(value.content)
  );

export type KnowledgeInput = z.infer<typeof knowledgeInputSchema>;

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

function revalidateKnowledge(itemId?: string, productIds: string[] = []) {
  revalidatePath('/[locale]/knowledge', 'page');
  if (itemId) {
    revalidatePath(`/[locale]/knowledge/${itemId}`, 'page');
    revalidatePath(`/[locale]/knowledge/${itemId}/edit`, 'page');
  }
  for (const productId of new Set(productIds)) {
    revalidatePath(`/[locale]/products/${productId}`, 'page');
  }
}

function itemColumns(input: KnowledgeInput) {
  return {
    kind: input.kind,
    title: input.title,
    content: input.content || null,
    url: input.url || null,
    status: input.status,
    file_url: input.file?.url ?? null,
    file_key: input.file?.key ?? null,
    file_name: input.file?.fileName ?? null,
    mime_type: input.file?.mimeType ?? null,
    size_bytes: input.file?.sizeBytes ?? null
  };
}

// Tag and product links are replaced wholesale — the edit form always submits
// the complete set. RLS lets only the item's author or an admin through.
async function replaceLinks(
  insforge: ServerClient,
  itemId: string,
  tagIds: string[],
  productIds: string[]
): Promise<boolean> {
  const [removedTags, removedProducts] = await Promise.all([
    insforge.database.from('knowledge_item_tags').delete().eq('item_id', itemId),
    insforge.database
      .from('knowledge_item_products')
      .delete()
      .eq('item_id', itemId)
  ]);
  if (removedTags.error || removedProducts.error) return false;

  const writes = [];
  if (tagIds.length > 0) {
    writes.push(
      insforge.database
        .from('knowledge_item_tags')
        .insert([...new Set(tagIds)].map((tagId) => ({
          item_id: itemId,
          tag_id: tagId
        })))
    );
  }
  if (productIds.length > 0) {
    writes.push(
      insforge.database
        .from('knowledge_item_products')
        .insert([...new Set(productIds)].map((productId) => ({
          item_id: itemId,
          product_id: productId
        })))
    );
  }

  const results = await Promise.all(writes);
  return results.every((result) => !result.error);
}

export async function createKnowledgeItemAction(
  input: KnowledgeInput
): Promise<KnowledgeActionResult> {
  const parsed = knowledgeInputSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('knowledge_items')
    .insert([{...itemColumns(parsed.data), author_id: caller.user.id}])
    .select('id')
    .single();

  if (error || !data) return {ok: false, error: 'generic'};

  const itemId = data.id as string;
  const linked = await replaceLinks(
    insforge,
    itemId,
    parsed.data.tagIds,
    parsed.data.productIds
  );
  if (!linked) {
    // Don't leave a half-linked item behind; the caller can retry cleanly.
    await insforge.database.from('knowledge_items').delete().eq('id', itemId);
    return {ok: false, error: 'generic'};
  }

  revalidateKnowledge(itemId, parsed.data.productIds);
  return {ok: true, itemId};
}

export async function updateKnowledgeItemAction(
  itemId: string,
  input: KnowledgeInput
): Promise<KnowledgeActionResult> {
  const parsed = knowledgeInputSchema.safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(itemId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const [{data: current}, {data: previousLinks}] = await Promise.all([
    insforge.database
      .from('knowledge_items')
      .select('file_key')
      .eq('id', itemId)
      .maybeSingle(),
    insforge.database
      .from('knowledge_item_products')
      .select('product_id')
      .eq('item_id', itemId)
  ]);

  const {data, error} = await insforge.database
    .from('knowledge_items')
    .update(itemColumns(parsed.data))
    .eq('id', itemId)
    .select('id');

  if (error) {
    return {
      ok: false,
      error: /cannot be converted/i.test(error.message ?? '')
        ? 'kindLocked'
        : 'generic'
    };
  }
  if (!data?.length) return {ok: false, error: 'forbidden'};

  const linked = await replaceLinks(
    insforge,
    itemId,
    parsed.data.tagIds,
    parsed.data.productIds
  );
  if (!linked) return {ok: false, error: 'generic'};

  const previousFileKey = (current?.file_key as string | null | undefined) ?? null;
  revalidateKnowledge(itemId, [
    ...parsed.data.productIds,
    ...(previousLinks ?? []).map((row) => row.product_id as string)
  ]);

  return {
    ok: true,
    itemId,
    previousFileKey:
      previousFileKey && previousFileKey !== parsed.data.file?.key
        ? previousFileKey
        : null
  };
}

export async function setKnowledgeArchivedAction(
  itemId: string,
  archived: boolean
): Promise<KnowledgeActionResult> {
  if (!z.string().uuid().safeParse(itemId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: links} = await insforge.database
    .from('knowledge_item_products')
    .select('product_id')
    .eq('item_id', itemId);

  const {data, error} = await insforge.database
    .from('knowledge_items')
    .update({archived_at: archived ? new Date().toISOString() : null})
    .eq('id', itemId)
    .select('id');

  if (error) return {ok: false, error: 'generic'};
  if (!data?.length) return {ok: false, error: 'forbidden'};

  revalidateKnowledge(
    itemId,
    (links ?? []).map((row) => row.product_id as string)
  );
  return {ok: true, itemId};
}

// Hard delete, author or admin only. Link rows cascade; the storage object is
// returned so the client can remove it after the row is gone.
export async function deleteKnowledgeItemAction(
  itemId: string
): Promise<KnowledgeActionResult & {fileKey?: string | null}> {
  if (!z.string().uuid().safeParse(itemId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const [{data: current}, {data: links}] = await Promise.all([
    insforge.database
      .from('knowledge_items')
      .select('file_key')
      .eq('id', itemId)
      .maybeSingle(),
    insforge.database
      .from('knowledge_item_products')
      .select('product_id')
      .eq('item_id', itemId)
  ]);

  const {data, error} = await insforge.database
    .from('knowledge_items')
    .delete()
    .eq('id', itemId)
    .select('id');

  if (error) return {ok: false, error: 'generic'};
  if (!data?.length) return {ok: false, error: 'forbidden'};

  revalidateKnowledge(
    itemId,
    (links ?? []).map((row) => row.product_id as string)
  );
  return {
    ok: true,
    itemId,
    fileKey: (current?.file_key as string | null | undefined) ?? null
  };
}

// Any active member may extend the tag vocabulary; uniqueness is
// case-insensitive, so a name that already exists resolves to that tag.
export async function createTagAction(name: string): Promise<TagActionResult> {
  const parsed = z.string().trim().min(1).max(60).safeParse(name);
  if (!parsed.success) return {ok: false, error: 'invalidTag'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const wanted = parsed.data.toLowerCase();

  const findExisting = async (): Promise<KnowledgeTag | null> => {
    const {data} = await insforge.database.from('tags').select('id, name');
    const match = (data ?? []).find(
      (row) => (row.name as string).toLowerCase() === wanted
    );
    return match ? {id: match.id as string, name: match.name as string} : null;
  };

  const existing = await findExisting();
  if (existing) return {ok: true, tag: existing};

  const {data, error} = await insforge.database
    .from('tags')
    .insert([{name: parsed.data, created_by: caller.user.id}])
    .select('id, name')
    .single();

  if (error || !data) {
    // Someone created the same tag between the lookup and the insert.
    const raced = await findExisting();
    if (raced) return {ok: true, tag: raced};
    return {ok: false, error: 'generic'};
  }

  revalidatePath('/[locale]/knowledge', 'page');
  return {ok: true, tag: {id: data.id as string, name: data.name as string}};
}

// Source files live in a private bucket: hand out a short-lived signed URL
// instead of persisting a public link.
export async function signKnowledgeFileAction(
  itemId: string
): Promise<SignedFileResult> {
  if (!z.string().uuid().safeParse(itemId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  // RLS decides whether this member may see the item at all.
  const {data: item} = await insforge.database
    .from('knowledge_items')
    .select('file_key, file_bucket')
    .eq('id', itemId)
    .maybeSingle();

  const key = (item?.file_key as string | null | undefined) ?? null;
  if (!key) return {ok: false, error: 'notFound'};

  // A mirrored artifact's object lives in the lifecycle bucket, not the
  // knowledge one — signing the wrong bucket is a 404, not a permission error,
  // so it would have looked like a missing file.
  const bucket = (item?.file_bucket as KnowledgeFileBucket | undefined) ??
    KNOWLEDGE_FILE_BUCKET;

  const {data, error} = await insforge.storage
    .from(bucket)
    .createSignedUrl(key, SIGNED_FILE_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) return {ok: false, error: 'generic'};
  return {ok: true, url: data.signedUrl};
}
