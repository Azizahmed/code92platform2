'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {RELEASE_CHECK_KEYS, RELEASE_STATUSES} from '@/lib/releases';

export type ReleaseActionResult =
  | {ok: true; releaseId: string}
  | {ok: false; error: string};

const uuid = z.string().uuid();

const releaseInputSchema = z.object({
  productId: uuid,
  version: z.string().trim().min(1).max(60),
  name: z.string().trim().max(240).nullable(),
  notes: z.string().trim().max(5000).nullable(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  ownerId: uuid.nullable()
});

const releaseEditSchema = releaseInputSchema.omit({productId: true});

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

// advance_release_status() raises with a human-readable reason. Map the ones
// the UI can act on to message keys; everything else falls through to a
// generic failure. Same convention as lib/actions/lifecycle.ts.
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
  if (message.includes('cannot move from')) return 'invalidTransition';
  if (message.includes('checklist of a')) return 'checklistClosed';
  // The UNIQUE (product_id, version) violation is the one a user hits by
  // accident and can fix themselves, so it deserves its own message.
  if (
    message.includes('product_releases_product_id_version_key') ||
    message.includes('duplicate key')
  ) {
    return 'duplicateVersion';
  }
  return 'generic';
}

export async function createReleaseAction(input: {
  productId: string;
  version: string;
  name: string | null;
  notes: string | null;
  targetDate: string | null;
  ownerId: string | null;
}): Promise<ReleaseActionResult> {
  const parsed = releaseInputSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_releases')
    .insert([
      {
        product_id: parsed.data.productId,
        version: parsed.data.version,
        name: parsed.data.name || null,
        notes: parsed.data.notes || null,
        target_date: parsed.data.targetDate,
        owner_id: parsed.data.ownerId,
        created_by: caller.user.id
      }
    ])
    .select('id')
    .single();

  // An RLS refusal and a genuine failure both land here; the policy is the
  // owner-or-admin rule, so 'forbidden' is the more useful default only when
  // the message says nothing.
  if (error || !data) return {ok: false, error: mapDatabaseError(error)};

  revalidateRelease(parsed.data.productId, data.id as string);
  return {ok: true, releaseId: data.id as string};
}

export async function updateReleaseAction(
  releaseId: string,
  input: {
    version: string;
    name: string | null;
    notes: string | null;
    targetDate: string | null;
    ownerId: string | null;
  }
): Promise<ReleaseActionResult> {
  const parsed = releaseEditSchema.safeParse(input);
  if (!uuid.safeParse(releaseId).success || !parsed.success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_releases')
    .update({
      version: parsed.data.version,
      name: parsed.data.name || null,
      notes: parsed.data.notes || null,
      target_date: parsed.data.targetDate,
      owner_id: parsed.data.ownerId
    })
    .eq('id', releaseId)
    .select('id, product_id');

  if (error) return {ok: false, error: mapDatabaseError(error)};
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
    .select('product_id, status')
    .eq('id', releaseId)
    .maybeSingle();

  if (!release) return {ok: false, error: 'notFound'};
  // The RLS policy already refuses this; saying so plainly beats a silent
  // zero-row delete that looks like success.
  if (release.status === 'released') {
    return {ok: false, error: 'releasedImmutable'};
  }

  const {error} = await insforge.database
    .from('product_releases')
    .delete()
    .eq('id', releaseId);

  if (error) return {ok: false, error: mapDatabaseError(error)};

  revalidateRelease(release.product_id as string);
  return {ok: true, releaseId};
}

export async function advanceReleaseStatusAction(
  releaseId: string,
  status: string,
  waiverReason?: string | null
): Promise<ReleaseActionResult> {
  if (
    !uuid.safeParse(releaseId).success ||
    !(RELEASE_STATUSES as readonly string[]).includes(status)
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('advance_release_status', {
    p_release_id: releaseId,
    p_status: status,
    p_waiver_reason: waiverReason?.trim() || null
  });

  if (error) return {ok: false, error: mapDatabaseError(error)};

  const row = (Array.isArray(data) ? data[0] : data) as
    | {product_id?: string}
    | undefined;
  if (row?.product_id) revalidateRelease(row.product_id, releaseId);
  return {ok: true, releaseId};
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

  if (error) return {ok: false, error: mapDatabaseError(error)};

  const {data: release} = await insforge.database
    .from('product_releases')
    .select('product_id')
    .eq('id', releaseId)
    .maybeSingle();
  if (release) revalidateRelease(release.product_id as string, releaseId);

  return {ok: true, releaseId};
}

// Moving work in or out of a release's scope. Separate from updateTaskAction
// so the release board can rescope without holding the whole task payload.
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

  if (error) return {ok: false, error: mapDatabaseError(error)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  revalidateRelease(data[0].product_id as string, releaseId ?? undefined);
  revalidatePath('/[locale]/tasks', 'page');
  return {ok: true, releaseId: releaseId ?? ''};
}
