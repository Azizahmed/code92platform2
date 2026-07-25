# Deployment

Deploys go through InsForge, which hosts on Vercel:

```bash
npx @insforge/cli deployments deploy .
```

Live at `https://5nteb3xb.insforge.site`. Env vars (`NEXT_PUBLIC_INSFORGE_URL`,
`NEXT_PUBLIC_INSFORGE_ANON_KEY`) are already set as persistent deployment vars
and are applied automatically — `.env*` is excluded from the upload, so they
cannot come from the repo.

## Measured latency structure — read before optimising anything

Every page is dynamic (`createInsForgeServerClient()` reads `cookies()`), so
each navigation runs a serverless function that then calls the backend.
The measured request path, from the `X-Vercel-Id` response header:

```
X-Vercel-Id: bom1::iad1::...
             ^^^^  ^^^^
             edge  function
```

| Hop | Location | Cost |
| --- | --- | --- |
| User (Gulf) → Vercel edge | `bom1` — Mumbai | ~30 ms (TCP confirmed) |
| Edge → function | `iad1` — N. Virginia | **~200–250 ms round trip** |
| Function → InsForge backend | AWS `us-east-2` — Ohio | ~15 ms per call |
| Measured page TTFB (warm floor) | | **~765 ms** |
| Static asset TTFB (`bom1` cache HIT, no function) | | ~540 ms |

The dominant cost is the Mumbai→Virginia leg, paid on every dynamic request.
Backend round trips are only ~15 ms each, so reducing their *count* — which is
worth ~187 ms each in local dev — is nearly invisible in production.

Note the backend region label is misleading: `us-east` in
`.insforge/project.json` resolves to
`alb-prod-gatewy-397152418.us-east-2.elb.amazonaws.com`, i.e. AWS **us-east-2
(Ohio)**, not us-east-1.

### `vercel.json` regions does NOT take effect

`vercel.json` declares `"regions": ["cle1"]`, but functions demonstrably run in
`iad1` (see the `X-Vercel-Id` above). The declaration is inert on this
deployment path — most likely because the hosting Vercel account's plan pins
functions to the default region. Do not assume changing it does anything;
verify with `curl -sS -D- -o /dev/null <url> | grep -i x-vercel-id` before
believing any region claim, including this file's.

The file is kept because it is correct and costs nothing if the app ever moves
to a deployment path that honours it.

## The real fix: move both tiers near the users

Users are in the Gulf; compute is in Virginia and data is in Ohio. No amount of
application-level optimisation closes a ~200 ms geographic gap.

InsForge regions available: `us-east`, `us-west`, `eu-central`, `ap-southeast`.
For Gulf users `eu-central` (Frankfurt) is the best available — roughly
40–60 ms, against ~200 ms+ to US East. Vercel's `fra1` matches it.

Target architecture: InsForge project in `eu-central`, functions in `fra1`.
Expected TTFB in the ~150–250 ms range rather than ~765 ms.

Migration caveat: InsForge cannot change a project's region in place
(`projects update` takes `--name`, `--domain`, `--storage-size` — no
`--region`). Moving means creating a new project in `eu-central`, replaying
`migrations/` with `db migrations up --all`, moving data, and re-pointing the
deployment env vars. Auth users do not move automatically.

**Do this sooner rather than later.** As of 2026-07-25 the dataset is tiny
(1 product, 1 task, 0 trends, 3 users), so the migration is nearly free now and
gets more expensive with every week of real use.

## TypeScript is pinned to 5.x on purpose

TypeScript 7 (the native Go compiler) is published and is `latest` on npm, but
this stack cannot use it yet:

- `typescript-eslint@8.65.0` declares `typescript: ">=4.8.4 <6.1.0"` and fails
  hard with "typescript-eslint does not support TS 7.0". No released version
  supports it, so linting breaks entirely.
- `next build` fails to load `next.config.ts` with
  `TypeError: Cannot read properties of undefined (reading 'fileExists')` —
  Next uses a TypeScript compiler API that the native port changed.

Re-test when `typescript-eslint` ships TS 7 support. The only source change it
needed was an ambient `declare module '*.css';` (TS 7 rejects side-effect
imports of untyped modules with TS2882, which TS 5 permitted).
