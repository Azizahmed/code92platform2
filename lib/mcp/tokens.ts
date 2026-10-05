import 'server-only';

import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {createAdminClient} from '@insforge/sdk';

import {isMcpPermission, type McpPermission} from './permissions';

export type McpCaller = {
  tokenId: string;
  userId: string;
  permissions: McpPermission[];
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

async function resolve(args: {p_token_hash: string} | {p_token_id: string}): Promise<McpCaller | null> {
  const admin = createAdminClient({baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    apiKey: process.env.INSFORGE_API_KEY!});
  const {data, error} = await admin.database.rpc('resolve_mcp_access_token', args);
  if (error) throw new Error('token resolution failed');
  const row = (Array.isArray(data) ? data[0] : data) as
    {token_id: string; user_id: string; permissions: unknown; display_name: string} | undefined;
  if (!row) return null;
  const permissions = Array.isArray(row.permissions) ? row.permissions.filter(isMcpPermission) : [];
  return {tokenId: row.token_id, userId: row.user_id, displayName: row.display_name,
    permissions: permissions.includes('read') ? permissions : ['read', ...permissions]};
}

export function resolveMcpCaller(token: string): Promise<McpCaller | null> {
  return resolve({p_token_hash: hashMcpToken(token)});
}

// For upload links: the link names the token that minted it, and a revoked or
// expired token takes its outstanding links with it.
export function resolveMcpCallerById(tokenId: string): Promise<McpCaller | null> {
  return resolve({p_token_id: tokenId});
}

function jwtSecret(): string {
  const secret = process.env.INSFORGE_JWT_SECRET;
  if (!secret) throw new Error('INSFORGE_JWT_SECRET is not set');
  return secret;
}

// The claim set InsForge's own sessions carry for RLS: auth.uid() reads `sub`.
// No email or other PII is added.
export function signMemberAccessToken(userId: string, now = Math.floor(Date.now() / 1000)): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({alg: 'HS256', typ: 'JWT'})}.${encode({
    sub: userId, role: 'authenticated', aud: 'insforge-api', iat: now, exp: now + ACCESS_TOKEN_SECONDS
  })}`;
  return `${unsigned}.${createHmac('sha256', jwtSecret()).update(unsigned).digest('base64url')}`;
}

// Opaque, tamper-proof handles for upload links and uploaded files. Signed with
// a key derived from the JWT secret under a label of their own, so a handle can
// never be replayed as a session token or the other way round.
function sealKey(): Buffer {
  return createHmac('sha256', jwtSecret()).update('code92-mcp-seal-v1').digest();
}

export function seal(kind: string, payload: object, ttlSeconds: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({...payload, kind, exp: Math.floor(now / 1000) + ttlSeconds}))
    .toString('base64url');
  return `${body}.${createHmac('sha256', sealKey()).update(body).digest('base64url')}`;
}

export function unseal<T extends object>(kind: string, value: unknown, now = Date.now()): T | null {
  if (typeof value !== 'string' || value.length > 8000) return null;
  const [body, signature, extra] = value.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = createHmac('sha256', sealKey()).update(body).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload?.kind !== kind || typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
    return payload as T;
  } catch {
    return null;
  }
}
