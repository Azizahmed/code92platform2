'use client';

import {createBrowserClient} from '@insforge/sdk/ssr';

// Browser client for Client Components. Reads the browser-readable
// `insforge_access_token` cookie and refreshes through /api/auth/refresh.
// Auth mutations (sign in/up/out) are server-only — see lib/actions/auth.ts.
export const insforge = createBrowserClient();
