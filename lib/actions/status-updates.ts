'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export type StatusUpdateActionResult = {ok: true} | {ok: false; error: string};

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
  const {error} = await insforge.database.from('status_updates').insert([
    {
      product_id: productId,
      author_id: user.id,
      source_type: 'manual',
      health,
      stage,
      summary,
      details: details || null
    }
  ]);

  if (error) return {ok: false, error: 'generic'};

  revalidatePath('/[locale]/products', 'page');
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]', 'page');
  return {ok: true};
}
