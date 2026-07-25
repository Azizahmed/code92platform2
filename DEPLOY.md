# Deployment

## Region pinning — read this before changing `vercel.json`

Every page in this app is dynamic: `createInsForgeServerClient()` reads `cookies()`,
so nothing is statically cached and each render talks to the InsForge backend.
A product detail page issues **7 backend round trips in sequence** before it can
paint. That makes server-to-backend latency the dominant cost of the whole app,
far ahead of bundle size or render time.

The backend is fixed in place:

- InsForge project `code92-command-center`, region label `us-east`
  (`.insforge/project.json`)
- `5nteb3xb.us-east.insforge.app` resolves to
  `alb-prod-gatewy-397152418.us-east-2.elb.amazonaws.com` — **AWS us-east-2 (Ohio)**

Note the label is misleading: `us-east` is Ohio (`us-east-2`), *not* N. Virginia
(`us-east-1`).

So `vercel.json` pins functions to **`cle1`** (Cleveland), which is Vercel's
us-east-2 region — the same AWS region as the backend.

Measured from a developer machine outside the US, each backend call costs
~187 ms warm and ~573 ms cold, which is why an un-pinned or distant deployment
makes the app feel broken:

| Deployment | Per-query | Product page (7 serial queries) |
| --- | --- | --- |
| Distant from backend | ~187 ms | ~1.3 s |
| `iad1` (N. Virginia) | ~15 ms | ~105 ms |
| `cle1` (Ohio, same region) | ~2 ms | ~15 ms |

If `cle1` is ever unavailable for the account or plan, `iad1` is a safe
fallback — it costs roughly 10 ms per query more, which is still ~100x better
than serving from outside the US. Do **not** leave the region unset.

If the backend is ever moved to another InsForge region, re-resolve the
hostname and re-pin this file to match. The two must stay together.

## Environment variables

Set these in the Vercel project (they are read by both server and browser code):

- `NEXT_PUBLIC_INSFORGE_URL`
- `NEXT_PUBLIC_INSFORGE_ANON_KEY`

Values are in `.env.local`, which is gitignored and must stay that way.

## Known caveat: middleware runs at the edge

`middleware.ts` calls `updateSession()` on every request, which is a network
call to InsForge. Vercel runs middleware in the Edge runtime, geographically
near the *user* — not in `cle1` — so that one call does not benefit from the
region pin and still costs a full long-haul round trip per navigation.

Two ways to close this, neither done yet:

1. Only refresh when the access token is actually near expiry (decode `exp`
   from the cookie locally), and skip the refresh entirely for prefetch and
   RSC-only requests. This is runtime-independent and the preferred fix.
2. Move middleware to the Node.js runtime so it runs in `cle1`. Requires
   `experimental.nodeMiddleware`, which is still experimental in Next 15.5.21.
