# Code 92 Command Center — Implementation Plan

## Context

Code 92 has multiple AI products, each with its own status, update cadence, and market context. Today there is no unified view — knowing where each product stands, when it's due for an update, and what market trends affect it requires chasing people. This plan builds an **internal bilingual (Arabic/English) command-center platform** that gives the team one dashboard for all products, an append-only status history per product, review-due tracking, and a **daily AI-powered market-intelligence feed** from day one.

Decisions confirmed with the user:
- **Users**: internal team only (v1), auth + admin/member roles
- **Status data**: manual entry in v1, schema designed so automated integrations (GitHub/monitoring/analytics) plug in later without a rebuild
- **Market intelligence**: AI-powered monitoring in v1 scope (not deferred)
- **Stack**: InsForge backend (BaaS) + Next.js (App Router) / React / TypeScript frontend
- **UI**: bilingual AR + EN with a language switcher, full RTL/LTR support

Repo is empty (greenfield), Windows dev environment.

## Architecture

```
Browser → Next.js app/[locale]/* (ar⇄en via <html dir>)
  Server Components/Actions → @insforge/sdk server client (user JWT, RLS enforced)
InsForge project:
  Auth (email/password, @insforge/sdk/ssr cookies)
  Postgres + RLS: team_members, products, status_updates, trend_items,
                  product_trends, scan_runs, product_overview view
  Edge Function `trend-scan` (Deno, admin key auto-injected)
  Schedule: cron */15 1 * * * → POST /functions/trend-scan (Bearer CRON_SECRET)
      → OpenRouter web-search model (default perplexity/sonar) → JSON trend items
```

- All app data access goes through RLS with the user's JWT; the Next.js server never holds the admin key. The only privileged writer is the `trend-scan` edge function (auto-injected `API_KEY`).
- Trend scanning = InsForge Schedule → Edge Function → OpenRouter web-search-capable model (one call does search + summarize + cite). **Apify is NOT used in v1** (private beta, cloud-only) — documented as the later option for structured scraping.
- No separate backend service. Server Actions for app mutations; edge function for the pipeline.
- Integration-ready: `status_updates.source_type`/`source_ref` discriminate manual vs future automated sources, which will reuse the same tables/triggers/UI via admin-key inserts.

## Data model (migration `0001_core_schema`)

RLS helpers (SECURITY DEFINER): `is_active_member()`, `is_admin()`. Anon gets nothing; every SELECT requires an active member.

- **`team_members`** — `user_id PK→auth.users`, `display_name`, `role('admin'|'member')`, `is_active BOOL DEFAULT false` (signup open, data access requires admin activation), timestamps. Self-insert limited to `user_id, display_name` via column grants; role/activation changes only through `admin_set_member(target, new_role, new_active)` RPC (SECURITY DEFINER, admin-only, protects last active admin). First admin bootstrapped once via `db query`.
- **`products`** — `id`, `name`, `slug UNIQUE`, `description`/`description_ar`, `category`, `stage(idea|development|beta|live|paused|sunset)`, `health(green|yellow|red|unknown)` *trigger-maintained*, `owner_id→auth.users`, `links JSONB`, `keywords TEXT[]` (feeds trend search), `trend_scan_enabled`, `review_interval_days DEFAULT 14`, `next_review_at` *trigger-maintained* (overdue when `< now()`), `last_status_update_at`, `last_trend_scan_at`, `archived_at` (soft delete, admin). UPDATE: owner or admin, column-granted; DELETE nobody. Indexes on owner/archived/next_review/last_scan.
- **`status_updates`** — append-only history: `product_id`, `author_id` (NULL for future automated), `source_type('manual'|'github'|'monitoring'|'analytics'|'import')`, `source_ref JSONB`, `health` (required), `stage` (NULL = unchanged), `summary`, `details`, `metrics JSONB`, `created_at`. REVOKE UPDATE/DELETE from authenticated; INSERT policy forces `author_id = auth.uid() AND source_type='manual'`. **AFTER INSERT trigger** updates parent product: health, stage, `last_status_update_at`, `next_review_at = created_at + review_interval_days`.
- **`trend_items`** — `title`, `summary`, `summary_ar` (same model call), `url`, `url_norm` (normalized; UNIQUE partial index = dedup), `source_name`, `published_at`, `found_at`, `raw JSONB`. Pipeline-only writes.
- **`product_trends`** — `(product_id, trend_item_id) PK`, `relevance_score 0–1`, `relevance_note`, `dismissed_at/dismissed_by` (only columns members may update). Pipeline-only insert, `ON CONFLICT DO NOTHING`.
- **`scan_runs`** — pipeline observability: `status('running'|'success'|'partial'|'failed')`, counts, per-product errors in `details JSONB`.
- **`product_overview` view** (`security_invoker = true`) — products + latest update + 7-day trend count + `is_overdue` + `staleness_days`; powers the dashboard in one query.

## Market-intelligence pipeline

- **Secrets**: `CRON_SECRET`, `OPENROUTER_API_KEY` (from `ai setup`), `OPENROUTER_TREND_MODEL` (default `perplexity/sonar`; fallback `openai/gpt-4o-mini:online`; **verify exact ID/pricing against `GET https://openrouter.ai/api/v1/models` at M5 — never guess model IDs**).
- **Schedule**: `*/15 1 * * *` UTC → 4 slots daily, each scans a batch of **≤5 products** where `trend_scan_enabled AND NOT archived AND last_trend_scan_at older than 20h` (oldest first). Cost cap: ≤1 model call/product/day, ~20 products/day capacity; empty batches no-op.
- **Function flow** (`functions/trend-scan.ts`): auth via `Bearer CRON_SECRET` *or* admin user JWT (enables admin "Scan now" button) → `createAdminClient` with auto-injected env → insert `scan_runs(running)` → per product (sequential, try/catch): one OpenRouter chat call asking for ≤5 items from last 7 days as strict JSON `[{title, summary, summary_ar, url, source_name, published_date, relevance_score, relevance_note}]`, `max_completion_tokens ≈ 1500`, 8–10s fetch timeout → zod-validate, drop items without parseable URL → upsert `trend_items` by `url_norm`, link `product_trends` idempotently → set `last_trend_scan_at` **even on failure** (error recorded) so one bad product can't starve the queue → finalize run `success|partial|failed`.

## Frontend

Scaffold: `create-next-app` (TS, App Router, Tailwind **3.4** per InsForge guidance). Packages: `@insforge/sdk`, `next-intl`, `zod`, `lucide-react`.

**i18n/RTL**: locale-prefixed routes `app/[locale]/…` (`en`, `ar`); `layout.tsx` sets `<html lang dir>` — the single RTL switch; fonts Inter + IBM Plex Sans Arabic. **Rule: logical Tailwind utilities only** (`ms/me`, `ps/pe`, `start/end`, `text-start`, `border-s/e`), directional icons `rtl:rotate-180`. One combined `middleware.ts`: next-intl locale routing + InsForge `updateSession()` + auth-cookie gate → `/{locale}/login`.

**SDK/state**: `lib/insforge/client.ts` (browser), `lib/insforge/server.ts` (server), `app/api/auth/refresh/route.ts` (`createRefreshAuthRouter`), auth mutations via `createAuthActions()` Server Actions. Data: Server Components query, Server Actions mutate + `revalidatePath`. No client state library; RLS is the real authorization.

**Pages** (under `app/[locale]/`):

| Route | Contents |
|---|---|
| `/login` | sign in/up, email-verification branch, "awaiting approval" state |
| `/` | dashboard: product cards (stage chip, health dot, owner, staleness, overdue badge, 7-day trend count), overdue-first sort |
| `/products`, `/products/new`, `/products/[id]`, `/products/[id]/edit` | table+filters; create form; detail = header + status timeline + "Post update" form + linked-trends panel (dismiss); owner/admin edit + archive |
| `/trends` | cross-product feed: filters, locale-appropriate summary (`summary_ar` when ar), source links, linked products |
| `/admin` | members (activate/role via RPC), scan-runs panel, "Scan now" (`insforge.functions.invoke('trend-scan')`) |

Shared: `HealthBadge`, `StageChip`, `RelativeTime`, `OverdueBadge`, `LocaleSwitcher`, `AppShell`.

## Build order (milestones, each verifiable)

- **M0 Backend bootstrap** — `npx @insforge/cli` login/create/link; gitignore `.insforge/`, `.env*`. *Verify:* `current` + `db query "SELECT 1"`.
- **M1 Schema+RLS** — migration `0001_core_schema` (everything above). *Verify:* negative RLS tests (anon denied; inactive user 0 rows; UPDATE status_updates denied); promote first admin via `db query`; `diagnose advisor --category security`.
- **M2 Next.js+i18n+auth** — scaffold, `[locale]` skeleton, both message files, combined middleware, SSR auth wiring, login page, locale switcher; post-signup action inserts pending `team_members` row. *Verify:* signup→pending→activate via CLI→dashboard shell; `/ar` renders RTL, `/en` LTR; signed-out deep link redirects.
- **M3 Registry+updates** — product CRUD pages, post-update form, timeline. *Verify:* create real Code 92 products; trigger effects visible (health/next_review moved); non-owner edit rejected; both locales.
- **M4 Dashboard** — `product_overview` cards, staleness/overdue. *Verify:* backdate `next_review_at` → overdue badge, sorts first.
- **M5 Trend pipeline** — confirm model ID; add secrets; deploy `trend-scan`; create schedule. *Verify:* invoke w/o secret → 401; with secret → `scan_runs success`, items+links populated; re-invoke → dedup holds; morning `schedules logs` green; intentional bad-secret run lands `failed/partial`.
- **M6 Trends UI** — `/trends`, product trends panel, dismiss, admin scan panel + Scan now. *Verify:* feed shows scanned items; dismiss persists; member "Scan now" rejected.
- **M7 RTL audit+polish** — grep-ban physical direction classes, icon mirroring, localized dates, both message files complete, empty/loading/error states. *Verify:* full click-through of every route in both locales, desktop + narrow; final `diagnose`.

One commit per milestone minimum; schema changes always as new migrations.

## Risks & defaults

| Risk | Default |
|---|---|
| Trend model choice | `perplexity/sonar` via secret, verify against models endpoint at M5 |
| Scan cost | daily, ≤5 items & 1 call/product/day, capped tokens (~20 calls/day) |
| Edge-fn wall clock | 5-product batches × 4 slots + per-call timeout |
| Arabic summary quality | `summary_ar` in same call; fall back to EN-only if poor |
| Open signup on internal tool | `is_active=false` approval gate + RLS everywhere |
| Model JSON drift / bad URLs | zod validation, drop URL-less items, `raw` kept, `url_norm` dedup |
| Cron timezone | assumed UTC; confirm via first `schedules logs`, shift hour if needed |

## Critical files

- `insforge/migrations/0001_core_schema.sql` — entire data model, RLS, triggers, view, RPC
- `functions/trend-scan.ts` — the whole market-intelligence pipeline
- `middleware.ts` — locale routing + session refresh + auth gate
- `app/[locale]/layout.tsx` — RTL/LTR switch, fonts, next-intl provider, shell
- `lib/insforge/server.ts` — server-side SDK client everything depends on
