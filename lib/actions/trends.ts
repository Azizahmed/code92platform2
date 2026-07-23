'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

// `error` is a message key under the `trends.errors` namespace, never a raw
// backend message — Server Actions must only return safe app data.
export type TrendsActionResult = {ok: true} | {ok: false; error: string};

const dismissSchema = z.object({
  productId: z.string().uuid(),
  trendItemId: z.string().uuid()
});

// Dismiss a product ↔ trend link. RLS grants UPDATE on only
// dismissed_at/dismissed_by, and the product_trends_guard_dismiss trigger
// requires dismissed_by to be the caller.
export async function dismissTrendAction(input: {
  productId: string;
  trendItemId: string;
}): Promise<TrendsActionResult> {
  const parsed = dismissSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'generic'};

  const user = await getSessionUser();
  if (!user) return {ok: false, error: 'generic'};

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database
    .from('product_trends')
    .update({
      dismissed_at: new Date().toISOString(),
      dismissed_by: user.id
    })
    .eq('product_id', parsed.data.productId)
    .eq('trend_item_id', parsed.data.trendItemId)
    .is('dismissed_at', null);
  if (error) return {ok: false, error: 'generic'};

  revalidatePath('/[locale]/trends', 'page');
  revalidatePath('/[locale]/products/[id]', 'page');
  return {ok: true};
}
