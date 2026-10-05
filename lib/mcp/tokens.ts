import 'server-only';

import {createHash, createHmac, randomBytes} from 'node:crypto';
import {createAdminClient} from '@insforge/sdk';

export type McpScope = 'read' | 'write';

export type McpCaller = {
  tokenId: string;
  userId: string;
  scope: McpScope;
  displayName: string;
};

const TOKEN_PATTERN = /^c92_[A-Za-z0-9_-]{43}$/;
// Long enough for a burst of tool calls in one request, short enough that a
// signed token is worthless soon after the request that needed it.
const ACCESS_TOKEN_SECONDS = 300;

// Both are server-only. The API key resolves a hash to its owner (nothing else
// uses it here); the JWT secret signs a token for exactly that owner, so every
// query afterwards is held to their RLS.
export function mcpAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_INSFORGE_URL && process.env.INSFORGE_API_KEY &&
    process.env.INSFORGE_JWT_SECRET);
}

export function generateMcpToken(): {token: string; hash: string; prefix: string} {
  const token = `c92_${randomBytes(32).toString('base64url')}`;
  return {token, hash: hashMcpToken(token), prefix: token.slice(0, 12)};
}

// The token carries 256 random bits, so a fast unsalted hash is sufficient;
// a slow KDF protects guessable secrets, which this is not.
export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function readBearerToken(header: string | null): string | null {
  const match = /^Bearer[ ]+(\S+)$/i.exec(header?.trim() ?? '');
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

export async function resolveMcpCaller(token: string): Promise<McpCaller | null> {
  const admin = createAdminClient({baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    apiKey: process.env.INSFORGE_API_KEY!});
  const {data, error} = await admin.database.rpc('resolve_mcp_access_token', {p_token_hash: hashMcpToken(token)});
  if (error) throw new Error('token resolution failed');
  const row = (Array.isArray(data) ? data[0] : data) as
    {token_id: string; user_id: string; scope: McpScope; display_name: string} | undefined;
  return row ? {tokenId: row.token_id, userId: row.user_id, scope: row.scope, displayName: row.display_name} : null;
}

// The claim set InsForge's own sessions carry for RLS: auth.uid() reads `sub`.
// No email or other PII is added.
export function signMemberAccessToken(userId: string, now = Math.floor(Date.now() / 1000)): string {
  const secret = process.env.INSFORGE_JWT_SECRET;
  if (!secret) throw new Error('INSFORGE_JWT_SECRET is not set');
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({alg: 'HS256', typ: 'JWT'})}.${encode({
    sub: userId, role: 'authenticated', aud: 'insforge-api', iat: now, exp: now + ACCESS_TOKEN_SECONDS
  })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
