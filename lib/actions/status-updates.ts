'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export type StatusUpdateActionResult =
  | {ok: true; statusUpdateId: string}
  | {ok: false; error: string};

export type DeleteStatusUpdateResult =
  | {ok: true; storageKeys: string[]}
  | {ok: false; error: string};

const statusUpdateSchema = z.object({
  productId: z.string().uuid(),
  health: z.enum(['green', 'yellow', 'red', 'unknown']),
  // null = stage unchanged; the AFTER INSERT trigger applies COALESCE.
  stage: z
    .enum(['idea', 'development', 'beta', 'live', 'paused', 'sunset'])
    .nullable(),
  summary: z.string().trim().min(1).max(500),
  details: z.string().trim().max(5000).nullable()
});

// Append a manual status update. RLS forces author_id = auth.uid() and
// source_type = 'manual'; the trigger then refreshes the parent product's
// health/stage/next_review_at, which revalidatePath surfaces immediately.
export async function postStatusUpdateAction(input: {
  productId: string;
  health: string;
  stage: string | null;
  summary: string;
  details: string | null;
}): Promise<StatusUpdateActionResult> {
  const parsed = statusUpdateSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return {ok: false, error: 'forbidden'};

  const {productId, health, stage, summary, details} = parsed.data;
  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('status_updates')
    .insert([
      {
        product_id: productId,
        author_id: user.id,
        source_type: 'manual',
        health,
        stage,
        summary,
        details: details || null
      }
    ])
    .select('id')
    .single();

  if (error || !data) return {ok: false, error: 'generic'};

  revalidatePath('/[locale]/products', 'page');
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]', 'page');
  return {ok: true, statusUpdateId: data.id as string};
}

// Remove an update from a product's timeline. RLS restricts this to the
// update's own author or an admin, and the AFTER DELETE trigger rebuilds the
// product's health/stage/next_review_at from whatever history remains -- so
// deleting the newest update rolls the product back to the one before it.
//
// Attachment rows cascade in the database, but their storage objects do not:
// the keys are read before the delete and handed back for the caller to clean
// up, matching deleteTaskAction.
export async function deleteStatusUpdateAction(
  statusUpdateId: string
): Promise<DeleteStatusUpdateResult> {
  if (!z.string().uuid().safeParse(statusUpdateId).success) {
    return {ok: false, error: 'invalid'};
  }

  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const [{data: update}, {data: attachments}] = await Promise.all([
    insforge.database
      .from('status_updates')
      .select('id, product_id')
      .eq('id', statusUpdateId)
      .maybeSingle(),
    insforge.database
      .from('status_update_attachments')
      .select('storage_key')
      .eq('status_update_id', statusUpdateId)
  ]);

  if (!update) return {ok: false, error: 'notFound'};

  const {data: deleted, error} = await insforge.database
    .from('status_updates')
    .delete()
    .eq('id', statusUpdateId)
    .select('id');

  if (error) return {ok: false, error: 'generic'};
  // RLS filters the row out rather than raising when the caller is neither the
  // author nor an admin, so an empty result means "not allowed", not "gone".
  if (!deleted?.length) return {ok: false, error: 'forbidden'};

  const productId = update.product_id as string;
  revalidatePath('/[locale]/products', 'page');
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]', 'page');

  return {
    ok: true,
    storageKeys: (attachments ?? []).map((row) => row.storage_key as string)
  };
}
