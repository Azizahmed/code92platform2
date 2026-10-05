import {AsyncLocalStorage} from 'node:async_hooks';
import {cookies} from 'next/headers';
import {createServerClient} from '@insforge/sdk/ssr';

// A bearer token for the current request when it did not arrive as a browser
// session — the MCP route signs one for the token's owner and runs its tool
// calls inside runWithAccessToken. Existing Server Actions then authenticate
// and query as that member without knowing where the request came from, and
// cookies are never consulted for such a request.
const requestAccessToken = new AsyncLocalStorage<string>();

export function runWithAccessToken<T>(accessToken: string, operation: () => Promise<T>): Promise<T> {
  return requestAccessToken.run(accessToken, operation);
}

export function hasRequestAccessToken(): boolean {
  return requestAccessToken.getStore() !== undefined;
}

// Server client for Server Components, Route Handlers, and Server Actions.
// Forwards the user's access-token cookie as the per-request bearer token,
// so every query runs under that user's RLS context. The refresh token
// stays server-owned (httpOnly).
export async function createInsForgeServerClient() {
  const accessToken = requestAccessToken.getStore();
  if (accessToken !== undefined) return createServerClient({accessToken});
  return createServerClient({cookies: await cookies()});
}
