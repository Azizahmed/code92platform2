import {cookies} from 'next/headers';
import {createServerClient} from '@insforge/sdk/ssr';

// Server client for Server Components, Route Handlers, and Server Actions.
// Forwards the user's access-token cookie as the per-request bearer token,
// so every query runs under that user's RLS context. The refresh token
// stays server-owned (httpOnly).
export async function createInsForgeServerClient() {
  return createServerClient({cookies: await cookies()});
}
