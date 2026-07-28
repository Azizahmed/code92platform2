'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  isGithubErrorCode,
  type GithubErrorCode,
  type OrgRepo
} from '@/lib/github';

// `error` is always a message key under the `github.errors` namespace, never a
// backend string — same rule as lib/actions/admin.ts.
export type GithubResult<T> =
  | ({ok: true} & T)
  | {ok: false; error: GithubErrorCode};

// The edge function answers with {error: {code, message}} on failure. Depending
// on how the SDK surfaces a non-2xx it may arrive as the response body, as an
// InsForgeError, or both — so look in every place a code could be before giving
// up and calling it generic.
function extractErrorCode(data: unknown, error: unknown): GithubErrorCode | null {
  const body = data as {error?: {code?: unknown}} | null;
  if (body?.error && isGithubErrorCode(body.error.code)) {
    return body.error.code;
  }

  if (!error) return body?.error ? 'generic' : null;

  const status = (error as {statusCode?: number}).statusCode;
  if (status === 401 || status === 403) return 'forbidden';

  const message = (error as {message?: string}).message ?? '';
  const match = /"code"\s*:\s*"([a-z_]+)"/.exec(message);
  if (match && isGithubErrorCode(match[1])) return match[1];

  return 'generic';
}

async function invokeGithubSync<T>(
  body: Record<string, unknown>
): Promise<GithubResult<T>> {
  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.functions.invoke('github-sync', {
    method: 'POST',
    body
  });

  const code = extractErrorCode(data, error);
  if (code) return {ok: false, error: code};

  return {ok: true, ...((data ?? {}) as T)};
}

async function requireAdmin(): Promise<boolean> {
  const member = await getOwnMembership();
  return member?.role === 'admin' && member.is_active === true;
}

async function requireActiveMember(): Promise<boolean> {
  const member = await getOwnMembership();
  return Boolean(member?.is_active);
}

// ============================================================
// Connection (admin only)
// ============================================================

const tokenSchema = z.object({
  token: z.string().min(20).max(500)
});

export async function saveGithubCredentialsAction(input: {
  token: string;
}): Promise<GithubResult<{org?: string; canWrite?: boolean}>> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};
  if (!(await requireAdmin())) return {ok: false, error: 'forbidden'};

  const result = await invokeGithubSync<{org: string; canWrite: boolean}>({
    action: 'save_credentials',
    token: parsed.data.token
  });

  if (result.ok) revalidatePath('/[locale]/admin', 'page');
  return result;
}

export async function testGithubConnectionAction(): Promise<
  GithubResult<{org?: string; canWrite?: boolean; repoCount?: number}>
> {
  if (!(await requireAdmin())) return {ok: false, error: 'forbidden'};

  const result = await invokeGithubSync<{
    org: string;
    canWrite: boolean;
    repoCount: number;
  }>({action: 'test_connection'});

  revalidatePath('/[locale]/admin', 'page');
  return result;
}

// ============================================================
// Repo linking (product owner or admin — enforced again in the function)
// ============================================================

const productIdSchema = z.string().uuid();

export async function listOrgReposAction(
  productId: string
): Promise<GithubResult<{repos?: OrgRepo[]; org?: string}>> {
  if (!productIdSchema.safeParse(productId).success) {
    return {ok: false, error: 'invalid'};
  }
  if (!(await requireActiveMember())) return {ok: false, error: 'forbidden'};

  return await invokeGithubSync<{repos: OrgRepo[]; org: string}>({
    action: 'list_repos',
    productId
  });
}

export async function linkProductRepoAction(input: {
  productId: string;
  repoId: number;
}): Promise<GithubResult<{repo?: {full_name: string}}>> {
  const parsed = z
    .object({productId: z.string().uuid(), repoId: z.number().int().positive()})
    .safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};
  if (!(await requireActiveMember())) return {ok: false, error: 'forbidden'};

  const result = await invokeGithubSync<{repo: {full_name: string}}>({
    action: 'link_repo',
    productId: parsed.data.productId,
    repoId: parsed.data.repoId
  });

  if (result.ok) revalidateProduct(parsed.data.productId);
  return result;
}

export async function unlinkProductRepoAction(
  productId: string
): Promise<GithubResult<Record<string, never>>> {
  if (!productIdSchema.safeParse(productId).success) {
    return {ok: false, error: 'invalid'};
  }
  if (!(await requireActiveMember())) return {ok: false, error: 'forbidden'};

  const result = await invokeGithubSync<Record<string, never>>({
    action: 'unlink_repo',
    productId
  });

  if (result.ok) revalidateProduct(productId);
  return result;
}

// ============================================================
// Mirroring
// ============================================================

// Called by the client after an artifact row is created. Deliberately a separate
// round trip rather than part of addPhaseArtifactAction: a GitHub commit takes
// seconds, and folding it into the upload would stall the response for a step
// that is allowed to fail without blocking the lifecycle.
export async function pushArtifactAction(
  artifactId: string
): Promise<GithubResult<{path?: string | null; skipped?: string}>> {
  if (!z.string().uuid().safeParse(artifactId).success) {
    return {ok: false, error: 'invalid'};
  }
  if (!(await requireActiveMember())) return {ok: false, error: 'forbidden'};

  return await invokeGithubSync<{path: string | null; skipped?: string}>({
    action: 'push_artifact',
    artifactId
  });
}

export async function deleteArtifactFromRepoAction(input: {
  productId: string;
  path: string;
}): Promise<GithubResult<Record<string, never>>> {
  const parsed = z
    .object({productId: z.string().uuid(), path: z.string().min(1).max(500)})
    .safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};
  if (!(await requireActiveMember())) return {ok: false, error: 'forbidden'};

  return await invokeGithubSync<Record<string, never>>({
    action: 'delete_artifact',
    productId: parsed.data.productId,
    path: parsed.data.path
  });
}

// Called after a phase transition so LIFECYCLE.md reflects the new state.
export async function pushManifestAction(
  productId: string
): Promise<GithubResult<{skipped?: string}>> {
  if (!productIdSchema.safeParse(productId).success) {
    return {ok: false, error: 'invalid'};
  }
  if (!(await requireActiveMember())) return {ok: false, error: 'forbidden'};

  return await invokeGithubSync<{skipped?: string}>({
    action: 'push_manifest',
    productId
  });
}

function revalidateProduct(productId: string): void {
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]/products', 'page');
}
