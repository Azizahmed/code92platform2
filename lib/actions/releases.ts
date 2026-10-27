'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  ARTIFACT_KEYS,
  RELEASE_CHECK_KEYS,
  RELEASE_STAGES,
  RELEASE_STATUSES
} from '@/lib/releases';
import {RISK_TIERS} from '@/lib/risk';

export type ReleaseActionResult =
  | {ok: true; releaseId: string; artifactId?: string}
  | {ok: false; error: string; detail?: string};

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

function revalidateRelease(productId: string, releaseId?: string) {
  revalidatePath('/[locale]/releases', 'page');
  if (releaseId) revalidatePath(`/[locale]/releases/${releaseId}`, 'page');
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]/governance', 'page');
  revalidatePath('/[locale]', 'page');
}

// The loop's RPCs raise with a readable reason. Map the ones a person can act
// on to keys. A stage that will not close says what is missing, so that goes
// through as `detail`.
function mapReleaseError(error: unknown): {error: string; detail?: string} {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as {message: unknown}).message)
      : String(error ?? '');

  const missing = /cannot close \w+ yet; missing: (.+)$/.exec(message);
  if (missing) return {error: 'stageIncomplete', detail: missing[1]};
  if (message.includes('waiver reason is required')) return {error: 'waiverRequired'};
  if (message.includes('need an admin')) return {error: 'adminRequired'};
  if (message.includes('only the product owner or an admin'))
    return {error: 'forbidden'};
  if (message.includes('only active members')) return {error: 'forbidden'};
  if (message.includes('a note is required to move a release backward'))
    return {error: 'noteRequired'};
  if (message.includes('a reason is required')) return {error: 'reasonRequired'};
  if (message.includes('cannot move back')) return {error: 'cannotMoveBack'};
  if (message.includes('cannot move from')) return {error: 'invalidTransition'};
  if (message.includes('set by the stage moves'))
    return {error: 'invalidTransition'};
  if (message.includes('has not reached yet')) return {error: 'notReachedYet'};
  if (message.includes('only artifacts of the current stage'))
    return {error: 'onlyCurrentStage'};
  if (message.includes('a link is required')) return {error: 'linkRequired'};
  if (message.includes('artifact_stage') || message.includes('url_check'))
    return {error: 'invalidLink'};
  if (message.includes('check constraint') && message.includes('url'))
    return {error: 'invalidLink'};
  if (message.includes('already approved')) return {error: 'alreadyApproved'};
  if (message.includes('one-line goal')) return {error: 'goalRequired'};
  if (message.includes('a cycle needs Gate 1')) return {error: 'gateOneRequired'};
  if (message.includes('a version is required')) return {error: 'versionRequired'};
  if (message.includes('cancelled')) return {error: 'cancelled'};
  if (message.includes('rolled back')) return {error: 'rolledBack'};
  if (message.includes('cancelled release takes no')) return {error: 'cancelled'};
  if (message.includes('already in stage')) return {error: 'alreadyInStage'};
  if (message.includes('move one stage at a time'))
    return {error: 'oneStepAtATime'};
  if (message.includes('is approved at Design') || message.includes('recorded at Test'))
    return {error: 'wrongStage'};
  if (message.includes('archived')) return {error: 'archived'};
  if (message.includes('high-risk')) return {error: 'adminRequired'};
  if (message.includes('product_releases_product_id_version_key') ||
      message.includes('duplicate key')) {
    return {error: 'duplicateVersion'};
  }
  if (message.includes('risk tier')) return {error: 'adminRequired'};
  return {error: 'generic'};
}

const cycleSchema = z.object({
  productId: uuid,
  version: z.string().trim().min(1).max(60),
  goal: z.string().trim().min(1).max(240),
  targetDate: dateSchema,
  successCriteria: z.string().trim().max(5000).nullable()
});

export async function createCycleReleaseAction(
  input: z.input<typeof cycleSchema>
): Promise<ReleaseActionResult> {
  const parsed = cycleSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('create_cycle_release', {
    p_product_id: parsed.data.productId,
    p_version: parsed.data.version,
    p_goal: parsed.data.goal,
    p_target_date: parsed.data.targetDate,
    p_success_criteria: parsed.data.successCriteria || null
  });

  if (error) return {ok: false, ...mapReleaseError(error)};
  const row = (Array.isArray(data) ? data[0] : data) as {id?: string} | undefined;
  if (!row?.id) return {ok: false, error: 'generic'};

  revalidateRelease(parsed.data.productId, row.id);
  return {ok: true, releaseId: row.id};
}

const releaseEditSchema = z.object({
  version: z.string().trim().min(1).max(60),
  name: z.string().trim().max(240).nullable(),
  goal: z.string().trim().max(240).nullable(),
  successCriteria: z.string().trim().max(5000).nullable(),
  notes: z.string().trim().max(5000).nullable(),
  targetDate: dateSchema,
  ownerId: nullableUuid,
  riskTier: z.enum(RISK_TIERS).optional()
});

export async function updateReleaseAction(
  releaseId: string,
  input: z.input<typeof releaseEditSchema>
): Promise<ReleaseActionResult> {
  const parsed = releaseEditSchema.safeParse(input);
  if (!uuid.safeParse(releaseId).success || !parsed.success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const d = parsed.data;
  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_releases')
    .update({
      version: d.version,
      name: d.name || null,
      goal: d.goal || null,
      success_criteria: d.successCriteria || null,
      notes: d.notes || null,
      target_date: d.targetDate,
      owner_id: d.ownerId,
      ...(d.riskTier ? {risk_tier: d.riskTier} : {})
    })
    .eq('id', releaseId)
    .select('id, product_id');

  if (error) return {ok: false, ...mapReleaseError(error)};
  if (!data?.length) return {ok: false, error: 'forbidden'};

  revalidateRelease(data[0].product_id as string, releaseId);
  return {ok: true, releaseId};
}

export async function deleteReleaseAction(
  releaseId: string
): Promise<ReleaseActionResult> {
  if (!uuid.safeParse(releaseId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: release} = await insforge.database
    .from('product_releases')
    .select('product_id, status, release_number')
    .eq('id', releaseId)
    .maybeSingle();

  if (!release) return {ok: false, error: 'notFound'};
  if (release.status === 'released') {
    return {ok: false, error: 'releasedImmutable'};
  }
  if (release.release_number === 0) {
    return {ok: false, error: 'mvpImmutable'};
  }

  const {error} = await insforge.database
    .from('product_releases')
    .delete()
    .eq('id', releaseId);

  if (error) return {ok: false, ...mapReleaseError(error)};

  revalidateRelease(release.product_id as string);
  return {ok: true, releaseId};
}

export async function moveReleaseStageAction(input: {
  releaseId: string;
  toStage: string;
  note?: string | null;
}): Promise<ReleaseActionResult> {
  const stage = z.enum(RELEASE_STAGES).safeParse(input.toStage);
  if (!uuid.safeParse(input.releaseId).success || !stage.success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('move_release_stage', {
    p_release_id: input.releaseId,
    p_to_stage: stage.data,
    p_note: input.note?.trim() || null
  });

  if (error) return {ok: false, ...mapReleaseError(error)};
  const row = (Array.isArray(data) ? data[0] : data) as
    | {product_id?: string}
    | undefined;
  if (row?.product_id) revalidateRelease(row.product_id, input.releaseId);
  return {ok: true, releaseId: input.releaseId};
}

export async function approveReleaseSpecAction(
  releaseId: string
): Promise<ReleaseActionResult> {
  if (!uuid.safeParse(releaseId).success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('approve_release_spec', {
    p_release_id: releaseId,
    p_note: null
  });

  if (error) return {ok: false, ...mapReleaseError(error)};
  const row = (Array.isArray(data) ? data[0] : data) as
    | {product_id?: string}
    | undefined;
  if (row?.product_id) revalidateRelease(row.product_id, releaseId);
  return {ok: true, releaseId};
}

export async function setReleaseTestResultAction(input: {
  releaseId: string;
  result: 'pass' | 'fail';
  findingsOpen: number;
  findingsClosed: number;
}): Promise<ReleaseActionResult> {
  if (
    !uuid.safeParse(input.releaseId).success ||
    !['pass', 'fail'].includes(input.result) ||
    !Number.isInteger(input.findingsOpen) ||
    !Number.isInteger(input.findingsClosed) ||
    input.findingsOpen < 0 ||
    input.findingsClosed < 0
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('set_release_test_result', {
    p_release_id: input.releaseId,
    p_result: input.result,
    p_findings_open: input.findingsOpen,
    p_findings_closed: input.findingsClosed
  });

  if (error) return {ok: false, ...mapReleaseError(error)};
  const row = (Array.isArray(data) ? data[0] : data) as
    | {product_id?: string}
    | undefined;
  if (row?.product_id) revalidateRelease(row.product_id, input.releaseId);
  return {ok: true, releaseId: input.releaseId};
}

const artifactSchema = z.object({
  releaseId: uuid,
  key: z.enum(ARTIFACT_KEYS as [string, ...string[]]),
  title: z.string().trim().min(1).max(240),
  url: z.string().trim().url().max(2000),
  commitRef: z.string().trim().max(100).nullable(),
  carryToNext: z.boolean()
});

export async function addReleaseArtifactAction(
  input: z.input<typeof artifactSchema>
): Promise<ReleaseActionResult> {
  const parsed = artifactSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalidLink'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('add_release_artifact', {
    p_release_id: parsed.data.releaseId,
    p_key: parsed.data.key,
    p_title: parsed.data.title,
    p_url: parsed.data.url,
    p_commit_ref: parsed.data.commitRef || null,
    p_carry_to_next: parsed.data.carryToNext
  });

  if (error) return {ok: false, ...mapReleaseError(error)};
  const row = (Array.isArray(data) ? data[0] : data) as
    | {id?: string; release_id?: string}
    | undefined;

  const {data: release} = await insforge.database
    .from('product_releases')
    .select('product_id')
    .eq('id', parsed.data.releaseId)
    .maybeSingle();
  if (release) revalidateRelease(release.product_id as string, parsed.data.releaseId);
  return {ok: true, releaseId: parsed.data.releaseId, artifactId: row?.id};
}

export async function removeReleaseArtifactAction(
  artifactId: string
): Promise<ReleaseActionResult> {
  if (!uuid.safeParse(artifactId).success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: artifact} = await insforge.database
    .from('release_artifacts')
    .select('release_id')
    .eq('id', artifactId)
    .maybeSingle();

  const {error} = await insforge.database.rpc('remove_release_artifact', {
    p_artifact_id: artifactId
  });

  if (error) return {ok: false, ...mapReleaseError(error)};
  if (artifact) {
    const {data: release} = await insforge.database
      .from('product_releases')
      .select('product_id')
      .eq('id', artifact.release_id as string)
      .maybeSingle();
    if (release) {
      revalidateRelease(release.product_id as string, artifact.release_id as string);
    }
    return {ok: true, releaseId: artifact.release_id as string};
  }
  return {ok: true, releaseId: ''};
}

// Cancelling, rolling back, and reopening. Forward movement is moveReleaseStage.
export async function exitReleaseAction(input: {
  releaseId: string;
  status: string;
  reason?: string | null;
}): Promise<ReleaseActionResult> {
  if (
    !uuid.safeParse(input.releaseId).success ||
    !(RELEASE_STATUSES as readonly string[]).includes(input.status)
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('advance_release_status', {
    p_release_id: input.releaseId,
    p_status: input.status,
    p_waiver_reason: input.reason?.trim() || null
  });

  if (error) return {ok: false, ...mapReleaseError(error)};
  const row = (Array.isArray(data) ? data[0] : data) as
    | {product_id?: string}
    | undefined;
  if (row?.product_id) revalidateRelease(row.product_id, input.releaseId);
  return {ok: true, releaseId: input.releaseId};
}

export async function setReleaseCheckAction(
  releaseId: string,
  checkKey: string,
  done: boolean,
  note?: string | null
): Promise<ReleaseActionResult> {
  if (
    !uuid.safeParse(releaseId).success ||
    !(RELEASE_CHECK_KEYS as readonly string[]).includes(checkKey) ||
    typeof done !== 'boolean'
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('set_release_check', {
    p_release_id: releaseId,
    p_check_key: checkKey,
    p_done: done,
    p_note: note?.trim() || null
  });

  if (error) return {ok: false, ...mapReleaseError(error)};

  const {data: release} = await insforge.database
    .from('product_releases')
    .select('product_id')
    .eq('id', releaseId)
    .maybeSingle();
  if (release) revalidateRelease(release.product_id as string, releaseId);

  return {ok: true, releaseId};
}

// Moving work in or out of a release's scope. Separate from updateTaskAction
// so the release page can rescope without holding the whole task payload.
export async function setTaskReleaseAction(
  taskId: string,
  releaseId: string | null
): Promise<ReleaseActionResult> {
  if (
    !uuid.safeParse(taskId).success ||
    (releaseId !== null && !uuid.safeParse(releaseId).success)
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_tasks')
    .update({release_id: releaseId})
    .eq('id', taskId)
    .select('id, product_id');

  if (error) return {ok: false, ...mapReleaseError(error)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  revalidateRelease(data[0].product_id as string, releaseId ?? undefined);
  revalidatePath('/[locale]/tasks', 'page');
  return {ok: true, releaseId: releaseId ?? ''};
}

// The artifact policy is admin-edited. A change applies to releases created from
// now on; the snapshot on each existing release does not move.
export async function setArtifactPolicyAction(input: {
  riskTier: string;
  kind: 'mvp' | 'cycle';
  artifactKey: string;
  required: boolean;
}): Promise<ReleaseActionResult> {
  if (
    !(RISK_TIERS as readonly string[]).includes(input.riskTier) ||
    !['mvp', 'cycle'].includes(input.kind) ||
    !(ARTIFACT_KEYS as readonly string[]).includes(input.artifactKey) ||
    typeof input.required !== 'boolean'
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};
  if (caller.member.role !== 'admin') return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('release_artifact_policy')
    .update({is_required: input.required})
    .eq('risk_tier', input.riskTier)
    .eq('kind', input.kind)
    .eq('artifact_key', input.artifactKey)
    .select('risk_tier');

  if (error) return {ok: false, ...mapReleaseError(error)};
  if (!data?.length) return {ok: false, error: 'notFound'};
  revalidatePath('/[locale]/governance', 'page');
  return {ok: true, releaseId: ''};
}
