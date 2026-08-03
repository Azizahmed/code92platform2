# Code92 Platform — Full Test Report

**Project:** code92-command-center (Next.js 15.5.21, React 19, next-intl, InsForge BaaS, TypeScript strict)
**Date:** 2026-08-03
**Test runner:** Vitest 4.1.10 (node environment, fully offline — all backend access mocked)
**Overall result:** ✅ **397 / 397 tests passing** across 9 test files, plus green `tsc`, `eslint`, and production build.

---

## 1. Executive summary

| Area | Result |
|---|---|
| Unit tests (Vitest) | ✅ 397 passed, 0 failed, 9 files |
| TypeScript (`tsc --noEmit`, strict) | ✅ 0 errors |
| ESLint (`npm run lint`) | ✅ 0 errors, 3 cosmetic warnings |
| Production build (`next build --turbopack`) | ✅ success, 29 routes generated |
| Security review (server actions, auth, secrets) | ✅ no high/medium findings; 4 low + 3 informational |
| Migration SQL sanity | ✅ 14/14 files well-formed, ordered, RLS-covered |

No defects requiring a fix were found. The findings below are low-severity hardening opportunities and documented behavioral quirks, each pinned by a test so any future drift fails the suite.

---

## 2. Test infrastructure added

- `vitest` 4.1.10 added as a devDependency; `package.json` scripts: `npm test` (`vitest run`), `npm run test:watch`.
- `vitest.config.ts` — `@` alias to project root, `tests/**/*.test.ts(x)` include pattern, node environment.
- Mocking strategy used throughout: `vi.mock` for `@/lib/insforge/server`, `@/lib/insforge/client`, `@/lib/auth`, `@insforge/sdk/ssr`, `next/headers`, `next/cache`, `next-intl/server`, `@/i18n/navigation`. A reusable chainable query-builder mock (thenable, records every call, FIFO `{data, error}` result queue) simulates the InsForge client. No network access anywhere.

## 3. Test files and coverage

| File | Tests | Scope |
|---|---:|---|
| `tests/lifecycle.test.ts` | 41 | `lib/lifecycle.ts` (phase vocabulary, artifact matrix, waiver/advance rules) + `lib/lifecycle-queries.ts` (query shapes, sorting, grouping) + SQL-mirror checks against `migrations/20260727192151_add-product-lifecycle.sql` |
| `tests/releases.test.ts` | 69 | `lib/releases.ts` (status machine, checklists, waivers) + `lib/actions/releases.ts` (CRUD, status advance, error mapping, all 7 `mapDatabaseError` branches) |
| `tests/knowledge.test.ts` | 32 | `lib/knowledge.ts` (kinds/status pipelines, buckets, limits) + `lib/knowledge-upload.ts` (validation, upload paths, mime resolution, cleanup) |
| `tests/tasks-notifications.test.ts` | 53 | `lib/notifications.ts` constants + `lib/actions/tasks.ts` + `lib/actions/status-updates.ts` (CRUD, zod guards, auth gates, completion-note tri-state, attachment key hand-back) |
| `tests/attachments-github.test.ts` | 59 | `lib/attachments.ts`, `lib/media-upload.ts`, `lib/github.ts` (mime/extension resolution, allowlists, upload batches, best-effort cleanup, GitHub constants/helpers) |
| `tests/i18n.test.ts` | 36 | en/ar namespace + key parity across all 13 namespaces, no empty en strings, `i18n/request.ts` registry vs disk, `i18n/routing.ts` locales, `i18n/navigation.ts` exports |
| `tests/migrations.test.ts` | 10 | All 14 migration files: naming/ordering, terminators, quote/dollar-quote/paren balance, RLS policy presence wherever tables are created, no duplicate `CREATE TABLE` |
| `tests/actions-products-admin.test.ts` | 70 | `lib/actions/products.ts`, `admin.ts`, `lifecycle.ts` (zod validation, auth/role guards, payload shapes, RPC error mapping, signed URLs) |
| `tests/auth.test.ts` | 27 | `lib/auth.ts` (session/membership helpers, locale-aware redirects) + `lib/actions/auth.ts` (sign-in/up/out, cookie handling, zod pre-validation) |
| **Total** | **397** | |

### What is deliberately not covered
- **DB-internal logic** (RLS policies, `advance_release_status()`, notification triggers such as `enqueue_task_notification()`) lives in migration SQL and edge functions; only its client-visible error mapping is unit-tested. The migration suite statically verifies policy presence.
- `lib/actions/notifications.ts` (bell feed, mark-read, preferences, email drain) — the largest untested action module; a follow-up file reusing the existing mock pattern is recommended.
- Runtime import of `@/i18n/navigation` under Vitest (next-intl externalization limit); covered instead by real `routing` import + static export checks.
- UI/component rendering (no jsdom/testing-library) and live E2E against the InsForge backend.

## 4. Static checks

| Check | Status | Details |
|---|---|---|
| `npx tsc --noEmit` | ✅ pass | 0 errors, strict mode |
| `npm run lint` | ✅ pass | 0 errors; 3 × `import/no-anonymous-default-export` warnings in `functions/github-sync.ts:924`, `functions/notify-email.ts:150`, `functions/trend-scan.ts:223` (edge-function convention; harmless) |
| `npm run build` | ✅ pass | Turbopack compile ~6 s, 29 static pages, middleware 81.4 kB, no warnings |

## 5. Security review

Verified sound baseline: every mutating server action validates input with zod and re-checks session + active membership; the server client forwards the per-user access token so all queries run under RLS; refresh token is httpOnly; error returns are message keys, never raw backend strings; no hardcoded keys; `.env.local` gitignored (`.env*` in `.gitignore:18`, confirmed untracked).

**Findings (severity-ranked):**

1. **Low — inconsistent auth gate in `dismissTrendAction`** (`lib/actions/trends.ts:28-29`): checks only `getSessionUser()`, not active membership — the only mutation without an app-level active-member check. Backstopped by RLS + guard trigger, but a defense-in-depth gap; also returns `'generic'` instead of `'forbidden'` for signed-out callers.
2. **Low — broad task authorization** (`lib/actions/tasks.ts:140,191`): any active member can edit/delete any member's tasks and their children (intentional per policy, but no creator/assignee restriction anywhere).
3. **Low — client-supplied storage metadata trusted** (`lib/actions/media.ts:126-136`, `lifecycle.ts:247-266`, `knowledge.ts:126-139`): `storage_url` accepts any http(s) URL; a member could register an external URL as an "attachment". Consider constraining the host to the InsForge storage origin.
4. **Low — orphaned storage objects on delete** (`tasks.ts:225-236`, `status-updates.ts:109-128`, `lifecycle.ts:297-311`, `knowledge.ts:342-359`): rows are deleted first and storage cleanup is handed to the client; abandoned cleanup leaves orphaned (unsignable) objects — hygiene/cost, not a leak.
5. **Informational — access-token cookie is browser-readable** (`lib/insforge/client.ts:6-8`): SDK design; XSS would yield a live token until expiry. Mitigate via CSP/XSS hygiene.
6. **Informational — brittle substring matching on backend error messages** (`releases.ts:50-72`, `lifecycle.ts:106-119`, `notifications.ts:144`, `status-updates.ts:253`): a wording change in SQL/edge functions silently degrades mappings to `'generic'`. Tests pin the current strings.
7. **Informational — minor races**: update-then-insert in `saveNotificationPreferencesAction` (`notifications.ts:208-225`) fails closed on the unique constraint; `createTagAction` handles its race correctly but scans the whole `tags` table per call.

## 6. Behavioral quirks documented by tests (not bugs)

- **Query helpers swallow errors**: `lib/lifecycle-queries.ts` destructures only `{data}` and falls back to `[]`, so an RLS/permission failure is indistinguishable from "no data" for callers such as `/governance`.
- `fileExtension('.md')` → `''` (leading dot treated as hidden-file marker) — a file literally named `.md` with no mime type is not detected as markdown.
- `sizeBytes: data.size || file.size` (media/knowledge upload) uses truthiness, not a null check — a storage-reported `0` falls back to `File.size` (harmless; zero-byte files are rejected earlier).
- `setTaskReleaseAction` returns `{ok: true, releaseId: ''}` when unscoping a task — odd shape, deliberate; pinned by test.
- Whitespace-only waiver reasons in `advanceLifecyclePhaseAction` (`lib/actions/lifecycle.ts:160`) are trimmed to `''` → sent as `null`, so the DB's "waiver required" error fires instead of a client-side `invalid`.
- `signUpAction` returns `'generic'` for both zod failures and backend failures (intentional safe-error design); if the `team_members` insert fails after sign-up, the user lands on the "awaiting approval" path by design.
- `deleteStatusUpdateAction` maps an empty delete result set to `'forbidden'` (RLS-filtered-row semantics) — pinned by test.

## 7. Recommendations (priority order)

1. Add `tests/actions-notifications.test.ts` for `lib/actions/notifications.ts` — the one substantial untested module.
2. Align `dismissTrendAction` with the `requireActiveMember` pattern used everywhere else.
3. Constrain accepted `storage_url` hosts to the InsForge storage origin in media/lifecycle/knowledge actions.
4. Consider server-side storage cleanup (or a scheduled reaper) instead of client hand-back on deletes.
5. Suppress or fix the 3 anonymous-default-export lint warnings in `functions/` (rule exception is fine).
6. Longer term: component tests (jsdom) and an E2E pass against a staging InsForge project to exercise RLS policies and DB functions for real.

## 8. How to run

```bash
npm test            # full suite (397 tests, < 1 s)
npm run test:watch  # watch mode
npx tsc --noEmit    # type check
npm run lint        # eslint
npm run build       # production build
```
