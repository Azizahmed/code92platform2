'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {MCP_GRANTABLE_PERMISSIONS} from '@/lib/mcp/permissions';
import {generateMcpToken} from '@/lib/mcp/tokens';
import type {McpTokenRow} from '@/lib/mcp/token-types';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // 'read' is implied; these are the extra abilities the owner chose.
  permissions: z.array(z.enum(MCP_GRANTABLE_PERMISSIONS)).max(MCP_GRANTABLE_PERMISSIONS.length),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)])
}).strict();

export type CreateMcpTokenResult =
  | {ok: true; token: string}
  | {ok: false; error: 'forbidden' | 'invalid' | 'limit' | 'failed'};

async function isActiveMember() {
  return (await getOwnMembership())?.is_active === true;
}

// The caller's own tokens only (RLS), newest first. The hash is not readable.
export async function getMcpTokensAction(): Promise<McpTokenRow[]> {
  if (!(await isActiveMember())) return [];
  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.from('mcp_access_tokens')
    .select('id, name, token_prefix, permissions, expires_at, last_used_at, revoked_at, created_at')
    .order('created_at', {ascending: false}).limit(50);
  if (error) return [];
  return (data ?? []) as McpTokenRow[];
}

// Returns the plaintext once. It is not stored, logged or retrievable later.
export async function createMcpTokenAction(input: z.input<typeof createSchema>): Promise<CreateMcpTokenResult> {
  if (!(await isActiveMember())) return {ok: false, error: 'forbidden'};
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};
  const {token, hash, prefix} = generateMcpToken();
  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('create_mcp_access_token', {
    p_name: parsed.data.name, p_token_hash: hash, p_token_prefix: prefix,
    p_permissions: ['read', ...new Set(parsed.data.permissions)],
    p_expires_at: new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString()
  });
  if (error) return {ok: false, error: /limit/i.test(error.message ?? '') ? 'limit' : 'failed'};
  revalidatePath('/[locale]/settings', 'page');
  return {ok: true, token};
}

export async function revokeMcpTokenAction(id: string): Promise<{ok: boolean}> {
  if (!z.string().uuid().safeParse(id).success || !(await isActiveMember())) return {ok: false};
  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('revoke_mcp_access_token', {p_id: id});
  if (error) return {ok: false};
  revalidatePath('/[locale]/settings', 'page');
  return {ok: true};
}
