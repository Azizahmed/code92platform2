# Code 92 Command Center — Specification

Internal bilingual (Arabic/English) command centre for Code 92's AI product
portfolio. One place to answer: *what are we building, where does each product
stand, what does the market say about it, and can we prove it was built
responsibly.*

This document specifies **what the system does**. For how it was built, see
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). For visual and RTL rules, see
[DESIGN.md](DESIGN.md). For deployment and measured latency, see
[DEPLOY.md](DEPLOY.md).

---

## 1. Purpose and scope

**In scope.** An internal tool for the Code 92 team covering the product
registry, status history, work items, a company knowledge base, an AI market
intelligence feed, a governed implementation lifecycle with document evidence,
portfolio-wide governance reporting, and mirroring of that evidence into GitHub.

**Out of scope (deliberate, v1).**

- No external/customer-facing access. Every route requires an active member.
- No per-product permission model. Authorisation is role plus ownership; there
  are no teams, groups, or per-product ACLs.
- No time tracking, sprint planning, or estimation.
- No automated status ingestion. `status_updates.source_type` reserves
  `github`/`monitoring`/`analytics`/`import` so this can be added without a
  schema rebuild, but v1 writes only `manual`.

---

## 2. Users, roles, and access

One account type, two roles, plus an activation gate.

| Capability | Anonymous | Pending member | Member | Admin |
|---|---|---|---|---|
| Sign up | ✅ | — | — | — |
| Read any application data | ❌ | ❌ | ✅ | ✅ |
| Create products, post updates, file artifacts | ❌ | ❌ | ✅ | ✅ |
| Edit / archive a product | ❌ | ❌ | own only | any |
| Advance a lifecycle phase | ❌ | ❌ | own, non-high-risk | any |
| Waive a high-risk gate | ❌ | ❌ | ❌ | ✅ |
| Set a product's risk tier | ❌ | ❌ | ❌ | ✅ |
| Link a product to a GitHub repository | ❌ | ❌ | own only | any |
| Configure the GitHub credential | ❌ | ❌ | ❌ | ✅ |
| Activate members, change roles | ❌ | ❌ | ❌ | ✅ |

**Activation gate.** Sign-up is open, but creates a `team_members` row with
`is_active = false`. Until an admin activates it the account reads nothing —
enforced in Postgres by RLS, not by the UI. A pending user sees an
"awaiting approval" state on `/login`.

**Last-admin protection.** `admin_set_member` refuses to demote or deactivate
the last active admin, so the workspace cannot be locked out.

**Authorisation is enforced in the database.** Row Level Security plus
column-scoped grants are the real boundary; the UI gate (`requireActiveMember`)
exists only so navigation behaves sensibly. Any requirement below that says
"only X may…" is a statement about RLS, a `SECURITY DEFINER` function, or a
grant — not about a hidden button.

---

## 3. Domain model

### 3.1 The two axes

A product carries **two independent state axes**, and conflating them is the
most common misreading of this system.

- **`stage`** — what the product *is* in the market: `idea`, `development`,
  `beta`, `live`, `paused`, `sunset`. Maintained by trigger from status updates.
- **Lifecycle phase** — where the product is in the *delivery process*:
  Ideation → Requirements → Plan → Code & Testing → Deploy → Monitor.

They overlap but are not the same. A `live` product can legitimately be back in
Requirements for v2. `stage` answers "can customers use it"; the lifecycle
answers "has this been through the process".

### 3.2 Entities

| Entity | Purpose |
|---|---|
| `team_members` | Roster; role and activation |
| `products` | The registry; stage, health, owner, risk tier, repo link |
| `status_updates` | Append-only health/stage history; drives product state by trigger |
| `status_update_attachments` | Files on an update |
| `product_tasks` | Work items, one level of sub-tasks, assignee, due date, ordering |
| `task_attachments` | Files on a work item |
| `knowledge_items` | Articles, notes and sources; markdown body or file or URL |
| `tags`, `knowledge_item_tags`, `knowledge_item_products` | Shared tag vocabulary; many-to-many links |
| `trend_items`, `product_trends` | Market intelligence and per-product relevance |
| `scan_runs` | Trend pipeline observability |
| `product_lifecycle_phases` | One row per (product, cycle, phase) with its state |
| `phase_artifacts` | Evidence: uploaded file, external URL, or knowledge-base citation |
| `phase_transitions` | Append-only gate audit: who advanced, what was missing, why waived |
| `github_connection` | The org credential, encrypted; **no client grants** |
| `github_sync_log` | Append-only record of every GitHub write |

Views: `product_overview` (dashboard in one query) and
`product_lifecycle_overview` (governance in one query).

---

## 4. Functional specification

### 4.1 Product registry

- Products have a unique slug, bilingual description, category, owner,
  arbitrary labelled links, and keywords that feed trend search.
- **Health is derived, not typed.** It is set by the status-update trigger, so
  the dashboard cannot disagree with the history.
- **Review cadence.** `review_interval_days` (default 14) drives
  `next_review_at`, recomputed on every update. A product past that date is
  *overdue* and sorts first on the dashboard.
- Products are **archived, never deleted** (`archived_at`). Archived products
  stay visible to owner and admin; everyone else gets a 404. Nobody holds
  DELETE.

### 4.2 Status updates

An update carries required `health`, optional `stage`, a summary, optional
details and metrics, and optional attachments. Posting one moves the parent
product's health, stage and review clock in the same transaction.

**Immutable, but removable.** `authenticated` holds no UPDATE grant, so an
update's content can never be rewritten. It *may* be deleted by its own author
or an admin, because a manually posted mistake would otherwise be permanent.
Deletion is not a simple row removal: an AFTER DELETE trigger rebuilds the
parent product's health, stage, `last_status_update_at` and `next_review_at`
from whatever history remains, so the product can never advertise the health of
a row that no longer exists. Attachments cascade.

### 4.3 Work items

Per-product tasks with a two-state status (`pending` → `completed`), one level of
sub-tasks via `parent_task_id`, assignee, due date, manual ordering via
`position`, and attachments. Parent/child rules a CHECK cannot reach are enforced
by `validate_product_task()`. A cross-product `/tasks` view aggregates them.

**Workflow status** (0.2) is a second, finer axis for the kanban: `todo`,
`in_progress`, `blocked`, `done`. It is kept in step with `status` by the same
trigger, in both directions — moving a card to Done completes the task (and so
notifies through the existing path), completing a task moves its card to Done,
and reopening sends it back to To do. Nothing else reads it, so every screen
built on `status` keeps working unchanged.

**Attachments** take documents as well as images: markdown, plain text, PDF and
the Office formats, up to 25 MB each. The allowlist is defined once in
`public.is_allowed_attachment_type()` and mirrored in `lib/attachments.ts`.
Markdown attachments are read in place rather than downloaded. A `.md` file
arrives from most desktops with an empty `File.type`, so the resolved type — the
browser's answer, or the extension when it has none — is what is validated and
stored.

### 4.4 Knowledge base

Three kinds with **per-kind status vocabularies**, enforced by CHECK and
defaulted by trigger:

| Kind | Statuses |
|---|---|
| `article`, `note` | `draft` → `published` |
| `source` | `to_review` → `in_use` → `processed` |

A source can never be converted to another kind. Items carry a markdown body, a
URL, or an uploaded file, are taggable from a shared case-insensitive vocabulary,
and link many-to-many to products — an unlinked item is company-wide knowledge.

**Bilingual search.** A stored `search_vector` is indexed under two
configurations: `english` (stemming) and `simple` (verbatim tokens, which is what
Arabic needs since Postgres ships no Arabic stemmer). `search_knowledge_items`
ORs both parses, ranks with `ts_rank`, weights title above body, and carries the
kind/status/tag/product/phase/origin/archived filters so the list view is one
round trip.

**Lifecycle artifacts appear here, with their origin attached.** Every file or
link filed against a lifecycle phase is mirrored into the knowledge base as a
`source` by the `mirror_artifact_to_knowledge()` trigger — so the PRD, the
threat model and the runbook are findable by searching for them rather than by
knowing which product and which of six phases they were filed under.

- **No bytes are copied.** The mirrored item records the artifact's existing
  storage key plus the *bucket* it lives in (`knowledge_items.file_bucket`), so
  both surfaces read one object. Signing resolves the bucket from the row.
- **No access widens.** `phase_artifacts` and `knowledge_items` are both
  readable under `is_active_member()` — the same audience. This was checked
  rather than assumed, because the artifacts include threat models and pentest
  reports.
- **Provenance is a record, not a claim.** `origin` and `source_artifact_id` are
  absent from the client `INSERT` grant and frozen by the validate trigger, so
  nothing can present itself as governed evidence when it is not. The
  `knowledge_provenance` view resolves item → artifact → phase → product for the
  UI, which shows it as a chip on each card and a panel on the item.
- **Direction matters.** `phase_artifacts.knowledge_item_id` means "this
  artifact *cites* a knowledge item" and predates this; `source_artifact_id`
  means "this knowledge item *came from* an artifact". Opposite arrows. An
  artifact that cites an item is never mirrored — it is already in there.
- **Lifetime follows the artifact.** Removing the artifact removes the mirrored
  item (`ON DELETE CASCADE`); the delete policy refuses to remove one directly,
  so the two cannot fall out of step. Title, status and tags stay editable —
  curating it is the point — while the source fields do not.

### 4.5 Market intelligence

An InsForge schedule invokes the `trend-scan` edge function, which scans a batch
of at most 5 due products (scan-enabled, not archived, not scanned in 20h,
least-recently-scanned first). For each it makes one web-search-capable
OpenRouter call requesting up to 5 items from the last 7 days as strict JSON,
validates with zod, drops items without a parseable URL, deduplicates on a
normalised URL, and links items to the product with a relevance score.

Two properties matter operationally:

- **A product is stamped even when its scan fails**, so one bad product cannot
  starve the queue.
- Every run opens a `scan_runs` row and closes it `success`/`partial`/`failed`
  with per-product errors, surfaced on `/admin`.

Members may dismiss an irrelevant trend link. Admins can trigger a scan manually.

### 4.6 Implementation lifecycle

Six phases, each with its own state (`not_started`, `in_progress`, `blocked`,
`complete`) rather than a single pointer — so the bar can honestly show
"Deploy complete, Monitor blocked". A `cycle` column ships unused by the v1 UI so
looping a product back for v2 is a feature rather than a migration through live
data.

Design follows [Anthropic's AI-native SDLC writeup](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle):
risk tiering, every decision logged with reasoning, and governance as a reporting
layer rather than a seventh phase.

**Artifact types accepted per phase**

| Phase | Types |
|---|---|
| Ideation | `concept_brief`, `research_note`, `other` |
| Requirements | `prd`, `threat_model`, `data_classification`, `other` |
| Plan | `design_doc`, `psr`, `architecture_decision`, `other` |
| Code & Testing | `security_review`, `test_report`, `review_evidence`, `other` |
| Deploy | `deploy_checklist`, `dast_scan`, `pentest_report`, `other` |
| Monitor | `runbook`, `postmortem`, `metrics_report`, `other` |

Filing a type against the wrong phase is rejected by trigger.

**Required artifacts by risk tier** — the gate matrix.

| Phase | `low` | `medium` | `high` |
|---|---|---|---|
| Ideation | — | — | — |
| Requirements | — | `prd` | `prd`, `threat_model` |
| Plan | — | `design_doc` | `design_doc`, `psr` |
| Code & Testing | — | `test_report` | `test_report`, `security_review` |
| Deploy | — | `deploy_checklist` | `deploy_checklist`, `dast_scan` |
| Monitor | — | — | `runbook` |

Low-risk products require nothing anywhere: the tier exists so small internal
tools stay frictionless while high-risk ones cannot ship unreviewed.

**Gate behaviour on completing a phase**

| Risk tier | Missing required artifacts | Result |
|---|---|---|
| `low` / `medium` | any | Proceeds; the gap is **recorded** in the audit row |
| `high` | none | Proceeds (admin only) |
| `high` | some, no waiver reason | **Rejected** |
| `high` | some, admin supplies a written reason | Proceeds; reason recorded |

Completing a phase promotes the next `not_started` phase to `in_progress`.

**Enforcement location.** The matrix exists twice on purpose:
`lifecycle_required_artifacts(phase, risk_tier)` in SQL is authoritative, and
`lib/lifecycle.ts` mirrors it so the UI can show the checklist before you hit the
gate. A client-side-only gate would be decoration. **Both must change together.**

**Write path.** `product_lifecycle_phases` is read-only to clients; every state
change goes through `advance_lifecycle_phase`, which re-derives permission,
recomputes what is missing server-side, and writes the audit row. The gate cannot
be skipped by calling the API directly.

**Audit.** Each transition records phase, from/to state, actor, risk tier at the
time, the missing artifact list, any waiver reason, and `self_approved` when the
actor was both product owner and the approving admin. `phase_transitions` is
SELECT-only to clients.

### 4.7 Governance

`/governance` is portfolio-wide oversight, not a phase:

- **Coverage** — every product's current phase, state, completed count, and open
  required-artifact gaps.
- **Stuck products** — anything in a non-complete phase for ≥ 30 days.
- **Waiver register** — every gate passed with a written reason.
- **Gate log** — the full transition history, self-approvals flagged.

### 4.8 Release management

The lifecycle says where a product is in the delivery process; a **release** says
what is going out, when, and what had to be true first. They are separate axes: a
product sits in `monitor` for a year while shipping a release a fortnight.

A release belongs to one product, carries a `version` unique within that product,
an optional name, notes, target date and owner, and moves through
`planned → in_progress → ready → released`, with `rolled_back` and `cancelled`
as recorded outcomes rather than dead ends. `release_status_can_follow()` defines
the legal moves; `advance_release_status()` is the only write path to `status`.

- **Scope** — tasks join a release via `product_tasks.release_id`, and only from
  the same product. That is what makes "ready" answerable from evidence.
- **Checklist** — `release_checks` is seeded at creation from the product's risk
  tier: release notes for everything, plus QA sign-off and a rollback plan at
  medium, plus security sign-off and change approval at high. The seeded list is
  **not** rewritten when the tier changes later — the checklist a release was
  held to is part of its record.
- **The gate** — bites only on `released`. Unmet checks and still-open scoped
  tasks (recorded as the pseudo-entry `open_tasks`) are gaps. Low and medium ship
  with the gaps recorded; high-risk requires a written waiver, exactly as the
  lifecycle gate does.
- **Audit** — `release_transitions` is append-only, records the risk tier at the
  time, the gaps, the waiver, and flags self-approval.

### 4.9 Notifications

Task activity reaches people two ways, and the database decides both.

`product_tasks_notify()` is an `AFTER INSERT OR UPDATE` trigger and the **only**
writer of `public.notifications` — no client role holds `INSERT`. Doing the
fan-out in the database rather than in server actions means a task changed from
anywhere still notifies the people following it.

- **Watching** — `task_watchers` is the opt-in. The author and the assignee are
  subscribed automatically; anyone else presses the bell on the task. Only you
  can add or remove yourself.
- **Events** — assignment and reassignment go to the person named; completion,
  reopening, and content edits go to watchers. Content edits collapse into one
  notification naming the fields that moved. Nobody is told about their own
  action.
- **In-app** — the bell in the shell, polling while the tab is visible. Reading
  is `read_at` only: the recipient's `UPDATE` grant covers that column and
  nothing else, so a notification cannot be rewritten or re-queued for mail.
- **Email** — opt-in per person via `notification_preferences`, off by default.
  The trigger only marks a row `pending`; `functions/notify-email.ts` drains the
  queue out of band on a second round trip from the app, claims each row via a
  `sending` state so overlapping drains cannot double-send, and batches one
  message per person. A mail outage cannot fail a task update, and nothing
  queued is lost — the next drain picks it up. Addresses are read through
  `notification_email_targets()`, which only answers for users with mail already
  queued, so it cannot double as a team directory.

**0.2 additions — deals, accounts, due dates.** The same table and the same
bell carry eight more types: `task_due`, `task_overdue`, `deal_assigned`,
`deal_due`, `deal_overdue`, `deal_closed`, `account_assigned`,
`account_archived`. `deal_watchers` and `account_watchers` follow the
`task_watchers` rules (self-service only; the owner is subscribed implicitly).

- **Who** — owner plus watchers, never the actor. Fan-out goes through
  `enqueue_notification()`, server-only, which dedupes on
  `(user_id, dedupe_key)` so a re-run never files twice.
- **Due / overdue** — `notification_enqueue_due()` runs once a day (05:00
  Kuwait; see DEPLOY.md). It files a due notice on the due date and one overdue
  notice the day after, with a three-day look-back so a missed run catches up.
  Completed tasks and closed deals are never chased. Dates are business dates:
  `public.business_today()` is Asia/Kuwait.
- **Preferences** — `notification_preferences` gains `email_on_due` and
  `email_on_closed`. **Owners cannot opt out of their own due/overdue email**:
  for the owner those rows are always queued `pending`, regardless of the email
  switch. Watchers' switches are respected.
- **Draining** — 0.2 mutations drain the outbox server-side with `after()` once
  the response is sent (`lib/email-drain.ts`), not by a second action from the
  client. The daily job's mail goes out in the same scheduled call.

### 4.10 GitHub integration

Each product links to **exactly one private repository** in the `code92-dev`
organisation, and lifecycle evidence is mirrored into it.

**Repository layout**

```
docs/lifecycle/
  LIFECYCLE.md          generated: phase states, risk tier, evidence index, gate log
  01-ideation/  02-requirements/  03-plan/
  04-code-test/ 05-deploy/        06-monitor/
```

Numeric prefixes so phases sort in lifecycle order in GitHub's file browser.

**Rules.**

- The repository must be **private** and owned by `code92-dev`. Public or
  foreign repositories are refused.
- The link is pinned by numeric repository id, so a rename on GitHub cannot
  silently repoint a product. `UNIQUE` on both columns stops two products
  claiming one repository.
- Only **file** artifacts become files. URL and knowledge-citation artifacts are
  listed in `LIFECYCLE.md` and marked `skipped`.
- An artifact and the refreshed manifest land in **one commit**, written through
  the Git Data API (blob → tree → commit → ref) rather than the Contents API,
  which is awkward above 1 MB.
- **Mirroring must never block the lifecycle.** It runs as a separate call after
  the artifact row exists; a failure is recorded on the row, shown as a badge,
  and retryable.
- Unlinking leaves already-pushed files in the repository. It is an
  administrative act here, not a request to destroy history there.

**Access-boundary warning.** Artifacts include threat models, PSRs and pentest
reports. In the platform they are readable only by active members; in a
repository they are readable by anyone with repository access in the org —
usually a wider audience, managed in a different system. Requiring private
repositories mitigates but does not remove this. Org membership should be
reviewed before enabling mirroring on a high-risk product.

---

### 4.11 My work (0.2)

`/my-work` answers "what is mine" in two tabs.

- **Assigned to me** — every open task assigned to the caller across products,
  plus Done cards for 14 days. List view groups by product (General last);
  kanban has To do / In progress / Blocked / Done and drag between them.
  Counters: overdue, due today, this week (Sunday–Saturday, business dates).
  Quick capture adds a task to the caller in one line; the full editor is the
  shared task editor, not a copy.
- **Waiting on me** — `my_waiting_on()` (one `SECURITY DEFINER` read, scoped to
  the caller) returns six sources: lifecycle gates whose required evidence is
  all filed (owner for low/medium risk, admin for high), pending agent
  proposals (product owner, or channel member when unbound), overdue product
  reviews, `@mentions` with no later reply from the caller in that thread (30
  days), stale deals, and deals whose expected close is this week. Items leave
  on their own once resolved; there is no dismiss state to drift.
- **Nav badge** — `my_work_counts()`: waiting items plus overdue tasks, rendered
  in the same request as the shell and refreshed by polling while visible.

### 4.12 Sales (0.2)

Accounts, contacts and deals, for the team to see who it is selling to.

- **Entities** — `accounts` (owner, sector, city, archive by owner/admin),
  `contacts` (one primary per account), `deals` (product or consultation;
  value + currency; expected close; next action + date; source), deal↔contact
  links within the same account, and an append-only `deal_activities` log.
- **Stages** — Lead → Meeting → Discovery/Demo → Proposal → Negotiation →
  Closed Won / Closed Lost. `stage` has no client `UPDATE` grant; every move
  goes through `move_deal_stage()`, which requires a reason for a backward move
  or a loss and logs the transition.
- **Outcomes** — a product win records the account as a customer of that
  product (`account_products`); a consultation win requires an ownership choice
  and opens an `engagements` row.
- **Stale** — an open deal is stale when it has had no next action for seven
  days, or its next-action date is more than seven days past
  (`deal_overview.is_stale`). Stale deals and deals closing this week also
  surface in Waiting on me.
- **Screens** — kanban and list with owner / type / product filters and
  totals by currency; deal page with stepper, next action, contacts, watchers
  and activity; account page with contacts, deals, products and engagements.

## 5. Security model

**Every table has RLS enabled, and `anon` holds no privilege on any of them.**

**Column-scoped grants.** Sensitive columns are protected by withholding the
grant, not by UI. Examples: `products.risk_tier` is admin-only via trigger;
`products.github_*` has SELECT but **no INSERT and no UPDATE** for any client;
`knowledge_items.author_id` and `search_vector` are outside the UPDATE grant.

> A table-level grant silently extends to columns added later. Any migration that
> adds a column to a table with a table-level INSERT/UPDATE grant must re-grant
> column-scoped. This is not hypothetical — it was found and fixed on `products`.

**Append-only tables.** `phase_transitions` and `github_sync_log` grant
`authenticated` nothing but SELECT — the audit record of what was decided and
what was pushed cannot be edited or erased from the application.
`status_updates` is a deliberate half-exception: no UPDATE grant, so history is
immutable, but DELETE is permitted to the update's author or an admin (§4.2).

**Privileged operations run as `SECURITY DEFINER` functions** with
`SET search_path = pg_catalog, public, pg_temp`: `is_active_member`, `is_admin`,
`admin_set_member`, `advance_lifecycle_phase`, `search_knowledge_items`,
`github_connection_status`, `github_is_configured`.

**The GitHub credential.** The Next.js app builds only per-user clients, so
anything it can read a browser can read. The org token therefore lives AES-GCM
encrypted in `github_connection` — a table with **no grants to any client role** —
under a key held only in the edge function's environment (`GITHUB_TOKEN_KEY`).
Admins read status through a `SECURITY DEFINER` function that structurally cannot
return the ciphertext. All GitHub calls happen inside the `github-sync` edge
function, which re-derives the caller's identity from their JWT on every action
and trusts nothing from the request body.

**Storage.**

| Bucket | Visibility | Contents |
|---|---|---|
| `product-media` | public | Product logos |
| `knowledge-files` | private | Knowledge-base source files |
| `lifecycle-artifacts` | private | Phase evidence documents |

Private buckets are read through **5-minute signed URLs minted at click time**,
never a stored public link.

**Secrets** live in InsForge secrets, never in the database or the repository:
`CRON_SECRET`, `OPENROUTER_API_KEY`, `OPENROUTER_TREND_MODEL`, `GITHUB_TOKEN_KEY`.

---

## 6. Internationalisation and RTL

- Locales `en` (default) and `ar`, locale-prefixed routes via `next-intl`.
- **The single RTL switch is `<html dir>`** in `app/[locale]/layout.tsx`. `dir`
  is never set elsewhere, except `dir="ltr"` on Latinate data (emails, URLs,
  slugs, repository names, commit SHAs) and `dir="auto"` on user-authored prose.
- **Logical Tailwind utilities only** — `ms/me`, `ps/pe`, `start/end`,
  `text-start`, `border-s/e`. Physical `ml/mr/pl/pr/left/right/text-left/
  text-right/border-l/border-r` are banned and audited.
- Directional icons get `rtl:rotate-180`; status and brand icons are not mirrored.
- Every user-visible string comes from a message file. Messages are split by
  namespace (`messages/<locale>/<namespace>.json`) and deep-merged; adding a
  namespace means creating it for **both** locales and registering it in
  `i18n/request.ts`.

---

## 7. Non-functional requirements

**Performance.** Every page is dynamic — `createInsForgeServerClient()` reads
cookies — so each navigation runs a serverless function that then calls the
backend. Measured warm TTFB is ~765 ms, dominated by a ~200–250 ms edge→function
hop between Mumbai and Virginia. Backend round trips are only ~15 ms each, so
reducing their *count* is nearly invisible in production. See DEPLOY.md before
optimising anything; the real fix is regional, not architectural.

**Availability.** GitHub being unavailable must degrade to a retryable badge,
never a blocked lifecycle. OpenRouter being unavailable must land a `failed` or
`partial` scan run, never a stuck queue.

**Data retention.** Only `products` is undeletable — nobody holds DELETE on it,
so a retired product is archived and keeps its history. Knowledge items also
carry `archived_at`, but *can* additionally be hard-deleted by their author or an
admin. Phase artifacts, work items and status updates are likewise deletable by
their owner or an admin; deleting a status update rebuilds the product's derived
state from the remaining history. The two audit tables (`phase_transitions`,
`github_sync_log`) cannot be altered or deleted from the application at all.

**Limits.** Uploads are capped at 25 MB in the app (bucket limit 50 MB). Trend
scanning is capped at ≤ 1 model call per product per day.

**Browser support.** Modern evergreen browsers. Mobile is a first-class layout,
not a fallback: compact header plus fixed bottom navigation, safe-area aware.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Stage** | Market maturity of a product (`idea` … `sunset`) |
| **Phase** | Position in the delivery lifecycle (Ideation … Monitor) |
| **Risk tier** | `low`/`medium`/`high`; decides which artifacts a phase requires |
| **Artifact** | Evidence filed against a phase: file, URL, or knowledge citation |
| **Gate** | The check run when completing a phase |
| **Waiver** | An admin's written reason for completing a high-risk phase with gaps |
| **Self-approval** | Actor was both the product owner and the approving admin |
| **PSR** | Project Security Review |
| **DAST** | Dynamic Application Security Testing |
| **Overdue** | `next_review_at` is in the past |
| **Stuck** | ≥ 30 days in a non-complete phase |
