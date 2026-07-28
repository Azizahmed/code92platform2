'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import type {SyncState} from '@/lib/github';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  SIGNED_FILE_URL_TTL_SECONDS
} from '@/lib/knowledge';
import {
  ALL_ARTIFACT_TYPES,
  LIFECYCLE_FILE_BUCKET,
  LIFECYCLE_STATES,
  RISK_TIERS,
  type ArtifactType,
  type LifecyclePhase,
  type LifecycleState,
  type RiskTier
} from '@/lib/lifecycle';

export type LifecyclePhaseRow = {
  id: string;
  product_id: string;
  cycle: number;
  phase: LifecyclePhase;
  state: LifecycleState;
  owner_id: string | null;
  notes: string | null;
  entered_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type PhaseArtifact = {
  id: string;
  phase_id: string;
  artifact_type: ArtifactType;
  title: string;
  storage_url: string | null;
  storage_key: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  knowledge_item_id: string | null;
  notes: string | null;
  generated_by: 'human' | 'agent';
  uploader_id: string;
  // Mirror state, written only by the github-sync edge function.
  github_path: string | null;
  github_commit_sha: string | null;
  github_synced_at: string | null;
  github_sync_error: string | null;
  github_sync_state: SyncState;
  created_at: string;
};

export type PhaseTransition = {
  id: string;
  product_id: string;
  cycle: number;
  phase: LifecyclePhase;
  from_state: LifecycleState | null;
  to_state: LifecycleState;
  actor_id: string;
  risk_tier_at_time: RiskTier;
  missing_artifacts: string[];
  waiver_reason: string | null;
  self_approved: boolean;
  created_at: string;
};

export type LifecycleActionResult =
  | {ok: true; phaseId: string}
  | {ok: false; error: string};

export type ArtifactActionResult =
  | {ok: true; artifactId: string; storageKey?: string | null}
  | {ok: false; error: string};

export type SignedArtifactResult =
  | {ok: true; url: string}
  | {ok: false; error: string};

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

function revalidateProduct(productId: string) {
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]/products', 'page');
  revalidatePath('/[locale]/governance', 'page');
  revalidatePath('/[locale]', 'page');
}

// The RPC raises with a human-readable reason. Map the ones the UI can act on
// to message keys; everything else falls through to a generic failure.
function mapDatabaseError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as {message: unknown}).message)
      : String(error ?? '');

  if (message.includes('waiver reason is required')) return 'waiverRequired';
  if (message.includes('require an admin')) return 'adminRequired';
  if (message.includes('only the product owner or an admin')) return 'forbidden';
  if (message.includes('only active members')) return 'forbidden';
  if (message.includes('archived')) return 'archived';
  if (message.includes('is not valid for phase')) return 'artifactType';
  return 'generic';
}

async function productIdForPhase(
  insforge: Awaited<ReturnType<typeof createInsForgeServerClient>>,
  phaseId: string
): Promise<string | null> {
  const {data} = await insforge.database
    .from('product_lifecycle_phases')
    .select('product_id')
    .eq('id', phaseId)
    .maybeSingle();
  return (data?.product_id as string | undefined) ?? null;
}

// Every state change goes through advance_lifecycle_phase: it re-computes the
// missing required artifacts server-side, enforces the risk-tier gate, and
// writes the append-only phase_transitions row. The client cannot skip it —
// product_lifecycle_phases grants no UPDATE to authenticated.
export async function advanceLifecyclePhaseAction(
  phaseId: string,
  state: LifecycleState,
  waiverReason?: string | null
): Promise<LifecycleActionResult> {
  const parsed = z
    .object({
      phaseId: z.string().uuid(),
      state: z.enum(LIFECYCLE_STATES),
      waiverReason: z.string().trim().max(2000).nullable().optional()
    })
    .safeParse({phaseId, state, waiverReason: waiverReason ?? null});
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const productId = await productIdForPhase(insforge, parsed.data.phaseId);

  const {error} = await insforge.database.rpc('advance_lifecycle_phase', {
    p_phase_id: parsed.data.phaseId,
    p_state: parsed.data.state,
    p_waiver_reason: parsed.data.waiverReason || null
  });

  if (error) return {ok: false, error: mapDatabaseError(error)};

  if (productId) revalidateProduct(productId);
  return {ok: true, phaseId: parsed.data.phaseId};
}

// Owner and notes carry no gate and produce no transition row.
export async function setLifecyclePhaseDetailsAction(
  phaseId: string,
  ownerId: string | null,
  notes: string | null
): Promise<LifecycleActionResult> {
  const parsed = z
    .object({
      phaseId: z.string().uuid(),
      ownerId: z.string().uuid().nullable(),
      notes: z.string().trim().max(5000).nullable()
    })
    .safeParse({phaseId, ownerId, notes});
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const productId = await productIdForPhase(insforge, parsed.data.phaseId);

  const {error} = await insforge.database.rpc('set_lifecycle_phase_details', {
    p_phase_id: parsed.data.phaseId,
    p_owner_id: parsed.data.ownerId,
    p_notes: parsed.data.notes
  });

  if (error) return {ok: false, error: mapDatabaseError(error)};

  if (productId) revalidateProduct(productId);
  return {ok: true, phaseId: parsed.data.phaseId};
}

const storedFileSchema = z.object({
  url: z.string().url().max(2000),
  key: z.string().trim().min(1).max(1000),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_KNOWLEDGE_FILE_BYTES)
});

const artifactInputSchema = z
  .object({
    phaseId: z.string().uuid(),
    artifactType: z.enum(ALL_ARTIFACT_TYPES as [ArtifactType, ...ArtifactType[]]),
    title: z.string().trim().min(1).max(240),
    notes: z.string().trim().max(5000).nullable(),
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .regex(/^https?:\/\//)
      .nullable(),
    knowledgeItemId: z.string().uuid().nullable(),
    file: storedFileSchema.nullable()
  })
  // Same rule the database enforces, checked here so the UI gets a usable
  // message instead of a constraint violation.
  .refine(
    (value) =>
      value.file !== null || Boolean(value.url) || Boolean(value.knowledgeItemId)
  );

export type PhaseArtifactInput = z.infer<typeof artifactInputSchema>;

export async function addPhaseArtifactAction(
  input: PhaseArtifactInput
): Promise<ArtifactActionResult> {
  const parsed = artifactInputSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const productId = await productIdForPhase(insforge, parsed.data.phaseId);

  const {data, error} = await insforge.database
    .from('phase_artifacts')
    .insert([
      {
        phase_id: parsed.data.phaseId,
        artifact_type: parsed.data.artifactType,
        title: parsed.data.title,
        notes: parsed.data.notes || null,
        url: parsed.data.url || null,
        knowledge_item_id: parsed.data.knowledgeItemId,
        storage_url: parsed.data.file?.url ?? null,
        storage_key: parsed.data.file?.key ?? null,
        file_name: parsed.data.file?.fileName ?? null,
        mime_type: parsed.data.file?.mimeType ?? null,
        size_bytes: parsed.data.file?.sizeBytes ?? null,
        uploader_id: caller.user.id
      }
    ])
    .select('id')
    .single();

  if (error || !data) return {ok: false, error: mapDatabaseError(error)};

  if (productId) revalidateProduct(productId);
  return {ok: true, artifactId: data.id as string};
}

// Hard delete. RLS lets only the product owner or an admin through; the storage
// object key comes back so the client can remove it after the row is gone.
export async function deletePhaseArtifactAction(
  artifactId: string
): Promise<ArtifactActionResult> {
  if (!z.string().uuid().safeParse(artifactId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: current} = await insforge.database
    .from('phase_artifacts')
    .select('storage_key, phase_id')
    .eq('id', artifactId)
    .maybeSingle();

  const productId = current?.phase_id
    ? await productIdForPhase(insforge, current.phase_id as string)
    : null;

  const {data, error} = await insforge.database
    .from('phase_artifacts')
    .delete()
    .eq('id', artifactId)
    .select('id');

  if (error) return {ok: false, error: mapDatabaseError(error)};
  if (!data?.length) return {ok: false, error: 'forbidden'};

  if (productId) revalidateProduct(productId);
  return {
    ok: true,
    artifactId,
    storageKey: (current?.storage_key as string | null | undefined) ?? null
  };
}

// The bucket is private: hand out a short-lived signed URL instead of the
// stored link. RLS decides whether this member may see the artifact at all.
export async function signPhaseArtifactAction(
  artifactId: string
): Promise<SignedArtifactResult> {
  if (!z.string().uuid().safeParse(artifactId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: artifact} = await insforge.database
    .from('phase_artifacts')
    .select('storage_key')
    .eq('id', artifactId)
    .maybeSingle();

  const key = (artifact?.storage_key as string | null | undefined) ?? null;
  if (!key) return {ok: false, error: 'notFound'};

  const {data, error} = await insforge.storage
    .from(LIFECYCLE_FILE_BUCKET)
    .createSignedUrl(key, SIGNED_FILE_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) return {ok: false, error: 'generic'};
  return {ok: true, url: data.signedUrl};
}

// Admin-only, enforced by the products_guard_risk_tier trigger. The tier
// decides how strict every gate on the product is.
export async function setProductRiskTierAction(
  productId: string,
  riskTier: RiskTier
): Promise<{ok: true} | {ok: false; error: string}> {
  const parsed = z
    .object({productId: z.string().uuid(), riskTier: z.enum(RISK_TIERS)})
    .safeParse({productId, riskTier});
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};
  if (caller.member.role !== 'admin') return {ok: false, error: 'adminRequired'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('products')
    .update({risk_tier: parsed.data.riskTier})
    .eq('id', parsed.data.productId)
    .select('id');

  if (error) return {ok: false, error: mapDatabaseError(error)};
  if (!data?.length) return {ok: false, error: 'forbidden'};

  revalidateProduct(parsed.data.productId);
  return {ok: true};
}
