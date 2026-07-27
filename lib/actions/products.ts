'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {RiskTier} from '@/lib/lifecycle';

// Shared product types used by the registry pages and components.

export type ProductStage =
  | 'idea'
  | 'development'
  | 'beta'
  | 'live'
  | 'paused'
  | 'sunset';

export type ProductHealth = 'green' | 'yellow' | 'red' | 'unknown';

export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  description_ar: string | null;
  category: string | null;
  stage: ProductStage;
  health: ProductHealth;
  owner_id: string;
  links: Record<string, string>;
  keywords: string[];
  trend_scan_enabled: boolean;
  review_interval_days: number;
  next_review_at: string | null;
  last_status_update_at: string | null;
  last_trend_scan_at: string | null;
  archived_at: string | null;
  logo_url: string | null;
  logo_key: string | null;
  // Set by admins only (products_guard_risk_tier); drives the lifecycle gates.
  risk_tier: RiskTier;
  created_at: string;
};

export type ProductActionResult =
  | {ok: true; productId: string}
  | {ok: false; error: string};

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const productInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: z.string().trim().max(2000).nullable(),
  descriptionAr: z.string().trim().max(2000).nullable(),
  category: z.string().trim().max(80).nullable(),
  stage: z.enum(['idea', 'development', 'beta', 'live', 'paused', 'sunset']),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20),
  links: z.record(z.string().trim().min(1).max(60), z.string().url().max(500)),
  reviewIntervalDays: z.number().int().min(1).max(365),
  trendScanEnabled: z.boolean(),
  logoUrl: z.string().url().max(2000).nullable(),
  logoKey: z.string().trim().min(1).max(1000).nullable()
}).refine((value) => Boolean(value.logoUrl) === Boolean(value.logoKey), {
  message: 'logo URL and key must be provided together'
});

type ProductInput = z.infer<typeof productInputSchema>;

function revalidateProductPaths(productId?: string) {
  revalidatePath('/[locale]/products', 'page');
  revalidatePath('/[locale]', 'page');
  if (productId) {
    revalidatePath(`/[locale]/products/${productId}`, 'page');
  }
}

// Unique-violation on products.slug → safe, actionable error key.
function isSlugConflict(error: {message?: string; code?: string}): boolean {
  return (
    error.code === '23505' ||
    (typeof error.message === 'string' &&
      error.message.toLowerCase().includes('duplicate'))
  );
}

// Every mutation re-checks the caller's session and active membership —
// the UI gate in lib/auth.ts is only for navigation, RLS is the real wall.
async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

export async function createProductAction(
  input: ProductInput
): Promise<ProductActionResult> {
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const {name, slug, description, descriptionAr, category, stage, keywords, links, reviewIntervalDays, trendScanEnabled, logoUrl, logoKey} =
    parsed.data;

  const insforge = await createInsForgeServerClient();
  // RLS forces owner_id = auth.uid(); server-maintained columns (health,
  // next_review_at, last_*) are column-revoked and trigger-maintained.
  const {data, error} = await insforge.database
    .from('products')
    .insert([
      {
        name,
        slug,
        description: description || null,
        description_ar: descriptionAr || null,
        category: category || null,
        stage,
        owner_id: caller.user.id,
        links,
        keywords,
        review_interval_days: reviewIntervalDays,
        trend_scan_enabled: trendScanEnabled,
        logo_url: logoUrl,
        logo_key: logoKey
      }
    ])
    .select('id')
    .single();

  if (error || !data) {
    return {ok: false, error: error && isSlugConflict(error) ? 'slugTaken' : 'generic'};
  }

  revalidateProductPaths(data.id as string);
  return {ok: true, productId: data.id as string};
}

export async function updateProductAction(
  productId: string,
  input: ProductInput & {ownerId?: string}
): Promise<ProductActionResult> {
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(productId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const isAdmin = caller.member.role === 'admin';
  const {name, slug, description, descriptionAr, category, stage, keywords, links, reviewIntervalDays, trendScanEnabled, logoUrl, logoKey} =
    parsed.data;

  // Only column-granted fields. owner_id reassignment is admin-only: RLS
  // WITH CHECK rejects a new owner_id != auth.uid() for non-admins.
  const patch: Record<string, unknown> = {
    name,
    slug,
    description: description || null,
    description_ar: descriptionAr || null,
    category: category || null,
    stage,
    keywords,
    links,
    review_interval_days: reviewIntervalDays,
    trend_scan_enabled: trendScanEnabled,
    logo_url: logoUrl,
    logo_key: logoKey
  };
  if (isAdmin && typeof input.ownerId === 'string' && z.string().uuid().safeParse(input.ownerId).success) {
    patch.owner_id = input.ownerId;
  }

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('products')
    .update(patch)
    .eq('id', productId)
    .select('id');

  if (error) {
    return {ok: false, error: isSlugConflict(error) ? 'slugTaken' : 'generic'};
  }
  if (!data?.length) return {ok: false, error: 'forbidden'};

  revalidateProductPaths(productId);
  return {ok: true, productId};
}

// Admin-only archive/unarchive. The DB trigger rejects non-admin archive
// attempts regardless; this check keeps the error key clean.
export async function setProductArchivedAction(
  productId: string,
  archived: boolean
): Promise<ProductActionResult> {
  if (!z.string().uuid().safeParse(productId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller || caller.member.role !== 'admin') {
    return {ok: false, error: 'forbidden'};
  }

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('products')
    .update({archived_at: archived ? new Date().toISOString() : null})
    .eq('id', productId)
    .select('id');

  if (error) return {ok: false, error: 'generic'};
  if (!data?.length) return {ok: false, error: 'notFound'};

  revalidateProductPaths(productId);
  return {ok: true, productId};
}
