# Code 92 Command Center — Implementation Plan

The as-built record of how this system was constructed, milestone by milestone,
with how each was verified — followed by what is still outstanding.

Companion documents: [SPECIFICATION.md](SPECIFICATION.md) (what the system does),
[DESIGN.md](DESIGN.md) (visual and RTL rules), [DEPLOY.md](DEPLOY.md) (deployment
and measured latency).

> Supersedes the original greenfield plan `code92_plan.md`, which covered M0–M8
> and described a repository that no longer exists in that form. Its full text
> remains in git history.

---

## 1. Context

Code 92 runs several AI products. Before this system there was no unified view:
knowing where a product stood, when it was due for review, and what the market
was saying required chasing people. Three later needs stacked on top — a shared
knowledge base, a governed delivery lifecycle with document evidence, and that
evidence living beside the code in GitHub.

Decisions fixed at the outset and still holding:

- **Users**: internal team only; auth with admin/member roles behind an
  activation gate.
- **Status data**: manual entry, with the schema shaped so automated ingestion
  plugs in later without a rebuild.
- **Market intelligence**: in v1 scope, not deferred.
- **Stack**: InsForge (Postgres BaaS) + Next.js App Router / React / TypeScript.
- **UI**: bilingual AR + EN, full RTL/LTR.

---

## 2. Architecture

```
Browser → Next.js app/[locale]/*            (ar ⇄ en via <html dir>)
  Server Components / Server Actions
    → @insforge/sdk server client            (user JWT — RLS enforced)

InsForge project "code92-command-center"
  Auth              email/password, @insforge/sdk/ssr cookies
  Postgres + RLS    18 tables, 2 views, SECURITY DEFINER helpers
  Storage           product-media (public), knowledge-files (private),
                    lifecycle-artifacts (private)
  Edge functions    trend-scan   — market intelligence pipeline
                    github-sync  — all GitHub reads and writes
  Schedule          cron → POST /functions/trend-scan (Bearer CRON_SECRET)
  Secrets           CRON_SECRET, OPENROUTER_API_KEY, OPENROUTER_TREND_MODEL,
                    GITHUB_TOKEN_KEY

Hosting             InsForge deployments → Vercel (5nteb3xb.insforge.site)
```

Three architectural commitments explain most of the code:

1. **The Next.js server never holds an admin key.** Every application query runs
   under the caller's JWT with RLS applied. The only privileged writers are the
   two edge functions, which receive the service key from their environment.
2. **Authorisation lives in Postgres.** RLS policies, column-scoped grants and
   `SECURITY DEFINER` functions are the boundary. UI checks are for navigation.
3. **Anything that must not be bypassable is a function, not a client rule.**
   Gate enforcement, member role changes and GitHub writes all run server-side
   and re-derive permission from the caller's identity.

---

## 3. Build sequence

Conventions applied throughout: one commit per milestone minimum; schema changes
**always** as a new migration, never an edit to an applied one; message files
updated for both locales in the same change.

### M0 — Backend bootstrap · `a98b62f`

InsForge project created and linked; `.insforge/` and `.env*` gitignored.
*Verified:* `insforge current`, `db query "SELECT 1"`.

### M1 — Core schema and RLS · `a98b62f` · `20260723161014_core-schema.sql`

`team_members`, `products`, `status_updates`, `trend_items`, `product_trends`,
`scan_runs`, the `product_overview` view, RLS helpers `is_active_member()` and
`is_admin()`, the `admin_set_member` RPC with last-admin protection, and the
status-update trigger that maintains product health, stage and review clock.

*Verified:* negative RLS tests — anon denied, inactive member reads zero rows,
UPDATE on `status_updates` denied; first admin promoted by `db query`.

### M2 — Next.js, i18n, auth · `cccd8ba`

App Router scaffold, `[locale]` routing, both message files, one combined
`middleware.ts` doing locale routing + InsForge `updateSession()` + the auth
gate, login page with the sign-up/awaiting-approval branch, locale switcher.

*Verified:* signup → pending → activate → dashboard; `/ar` renders RTL and `/en`
LTR; signed-out deep links redirect to the locale-correct login.

### M5 — Trend pipeline · `cccd8ba` · `functions/trend-scan.ts`

Built before the UI that consumes it. Schedule → edge function → one
web-search-capable OpenRouter call per product → zod validation → URL-normalised
dedup → idempotent product links. Batches of ≤ 5 due products; a product is
stamped even when its scan fails so one bad product cannot starve the queue.

*Verified:* invoke without the secret → 401; with it → `scan_runs` success and
populated items; re-invoke → dedup holds.

### M3, M4, M6 — Registry, dashboard, trends UI, admin · `19a6c23`

Product CRUD, status timeline and post-update form, dashboard cards driven by
`product_overview` (overdue first), cross-product trends feed with dismiss, and
the admin console with the members table, scan-run observability and "Scan now".

*Verified:* real products created; trigger effects visible; non-owner edit
rejected; member "Scan now" rejected; backdated `next_review_at` surfaces the
overdue badge and sorts first.

### M7 — RTL audit and polish · `056d84f`

Grep-ban on physical direction utilities, icon mirroring, localised dates,
complete message files, empty/loading/error states.

*Verified:* full click-through of every route in both locales, desktop and narrow.

### M8a — Work items and media · `d20f6fe` · `20260724084425_…`

`product_tasks` with one level of sub-tasks, assignee, due date, manual ordering
and attachments; `task_attachments`; the public `product-media` bucket for logos;
`validate_product_task()` enforcing parent/child rules a CHECK cannot reach.

### M8b — Theme switcher · `53b8d77`

Light and dark modes with the saved choice restored before first paint,
defaulting to the OS preference.

### M8c — Knowledge base · `e013c81` · `20260724143608_…`

Articles, notes and sources with per-kind status vocabularies, a shared
case-insensitive tag vocabulary, many-to-many links to products, and the private
`knowledge-files` bucket with 5-minute signed URLs.

The interesting part is **bilingual search**: a stored `search_vector` indexed
under both `english` (stemming) and `simple` (verbatim tokens — what Arabic needs,
since Postgres has no Arabic stemmer). `search_knowledge_items` ORs both parses,
ranks with `ts_rank`, and carries every filter so the list is one round trip.

*Verified:* kind/status pairing rejects bad rows; source→article conversion
rejected; an English stem query and an Arabic verbatim query both match; `anon`
holds nothing on all four tables; `author_id` and `search_vector` are outside the
UPDATE grant.

### M8d — Performance pass · `1b47f7b`, `7d880a4` · `20260725073844_…`

Collapsed the auth waterfall and cut per-interaction round trips, then **measured
production** and corrected DEPLOY.md to match. The finding that matters: the
dominant cost is a ~200–250 ms Mumbai→Virginia hop paid on every dynamic request,
so reducing backend round-trip *count* is nearly invisible in production. The
real fix is regional.

### M8e — Status update deletion · `2246f78` · `20260725092220_…`

A narrowly scoped exception to the append-only rule, with the product's derived
state recomputed from the remaining history.

### M9 — Implementation lifecycle and governance · `3d4a00e` · `20260727192151_…`

Six phases with per-phase state, risk-tiered gates, artifact evidence, an
append-only transition audit, and the `/governance` reporting layer. Design
follows Anthropic's AI-native SDLC writeup: risk tiering, decisions logged with
reasoning, governance as a layer rather than a seventh phase.

Key implementation choices:

- **`stage` and lifecycle phase kept as separate axes** — a `live` product can be
  back in Requirements for v2.
- **The gate matrix lives twice**, authoritative in SQL and mirrored in
  `lib/lifecycle.ts` for the UI checklist. A client-only gate is decoration.
- **`product_lifecycle_phases` is read-only to clients**; all writes go through
  `advance_lifecycle_phase`, which recomputes what is missing server-side.
- **`cycle` ships unused** so looping back for v2 is later a feature, not a
  migration through live data.
- The lifecycle bar's connectors use half-segment logical insets, so it mirrors
  under RTL with no flip rules at all.

*Verified:* six DB guards reject correctly; privileges exactly as designed;
backfill produced 12 correct rows; the gate matrix and view maths check out; a
new product auto-seeds six phases; posting a status update still moves
health/stage (the new risk-tier trigger does not block the trusted trigger path);
signed-out `/governance` redirects correctly in both locales; 128 message keys
per locale with zero gaps.

### M10 — GitHub integration · `b890f36` · `20260728071659_…`, `20260728072155_…`

Each product links to one private repository in `code92-dev`; lifecycle artifacts
are mirrored into `docs/lifecycle/<phase>/` alongside a generated `LIFECYCLE.md`.

The design is shaped entirely by one constraint: **the app has no service-role
client**, so a token in a normally-granted table would be readable by any admin's
browser through PostgREST. Therefore the token is AES-GCM encrypted in
`github_connection` — a table with no grants to any client role — under a key held
only in the `github-sync` environment, and every GitHub call happens inside that
function.

Other decisions worth knowing:

- Commits use the **Git Data API** (blob → tree → commit → ref), not the Contents
  API: it handles files above 1 MB and lets the artifact and refreshed manifest
  land in one commit.
- The link pins the **numeric repository id**, so a rename cannot silently
  repoint a product.
- **Mirroring is a second round trip** after the artifact row exists, never
  inline — a commit takes seconds and GitHub must never block the lifecycle.
  Failures are recorded on the row and retryable from a badge.
- Public repositories and repositories outside the org are refused.

*Verified:* `github_connection` has zero privileges for `anon` and
`authenticated`; `products.github_*` is SELECT-only with INSERT and UPDATE at
zero; four constraint guards reject; the deployed function returns 401 to an
anonymous call **and** to the admin API key — only a member JWT drives it; 68
message keys per locale with exact parity and the error-code list matching the
messages.

**A gap found during M10.** `products` held a *table-level* INSERT grant, and
table-level grants silently extend to columns added later — so the new link
columns inherited INSERT and a client could have fabricated a repository link at
product-creation time. Fixed in a second migration rather than by editing an
applied one. **This class of bug applies to any future column added to a table
with a table-level grant.**

### M11 — Repository move

Source moved from the personal `Azizahmed/code92_platform` to the organisation
repository `code92-dev/code92platform`; `master` fast-forwarded to carry all
work, pushed as `main`, `origin` repointed.

---

## 4. Outstanding work

### Blocked on a credential

The GitHub integration is deployed but **inert until a fine-grained PAT is
created** (resource owner `code92-dev`, Contents: read and write) and saved in
Admin → GitHub. Everything past that boundary is therefore unverified: repository
listing, linking, the commit machinery, `LIFECYCLE.md` generation, artifact
deletion, and the retry path. Also unverified: whether the SDK preserves the edge
function's error body on a non-2xx — the action layer maps defensively from both
the body and the `InsForgeError`, but which branch actually fires is untested.

### Needs an authenticated session to verify

Carried from M9 and still open:

- Owner vs member vs admin paths through `advance_lifecycle_phase`.
- The high-risk waiver flow end to end, and its appearance in `/governance`.
- Upload → signed-URL round trip against the private buckets.
- Arabic RTL rendering of the lifecycle bar.
- **Mobile bottom navigation at 360 px with 7 admin tabs.** Adding Governance
  made this 6 items for members and 7 for admins, at roughly 51 px each. If it is
  too tight, move Governance into the preferences sheet or behind an admin group
  rather than shrinking every tab.

### Known issues

- **The security advisor is unavailable** on this project — `pg_stat_statements`
  is not installed, so `diagnose advisor` prints "No issues found" over an empty
  result set. No automated security scan has actually run against this schema.
  Treat prior "advisor clean" claims as reporting nothing.
- **No README.md** at the repository root, so the org repo's front page is bare.
- Pre-existing lint errors in `functions/trend-scan.ts` (2 × `no-explicit-any`).
  `functions/` is excluded from `tsconfig.json`, so nothing there is typechecked.

### Planned

- **Region move — do this sooner rather than later.** Users are in the Gulf,
  compute is in Virginia, data in Ohio. `eu-central` + Vercel `fra1` should take
  TTFB from ~765 ms to the ~150–250 ms range. InsForge cannot change a project's
  region in place: it means a new project, replaying `migrations/`, moving data,
  and re-pointing deployment env vars — auth users do not move automatically. The
  dataset is still tiny, and this gets more expensive every week.
- **Token rotation.** Fine-grained PATs expire. The settings panel surfaces the
  expiry and warns at 14 days; there is no automated rotation.
- **Scheduled sync drain.** `github_sync_state` already supports `pending`, so a
  schedule that retries failed mirrors needs no migration.
- **Automated PSR generation.** `phase_artifacts.generated_by` and `agent_run_id`
  are reserved for an agent-produced Project Security Review; wiring it needs no
  migration.
- **Automated status ingestion** via `status_updates.source_type`.

---

## 5. Critical files

| File | Why it matters |
|---|---|
| `migrations/*.sql` | The entire data model, RLS, triggers, views, RPCs — in order |
| `functions/github-sync.ts` | All GitHub I/O; the only holder of the org credential |
| `functions/trend-scan.ts` | The whole market-intelligence pipeline |
| `middleware.ts` | Locale routing + session refresh + auth gate, in one pass |
| `app/[locale]/layout.tsx` | The single RTL switch, fonts, next-intl provider |
| `lib/insforge/server.ts` | The per-user server client everything depends on |
| `lib/lifecycle.ts` | Mirrors the SQL gate matrix — change both together |
| `lib/github.ts` | Error codes mirroring the edge function — change both together |
| `i18n/request.ts` | Namespace registry; both locales required |
