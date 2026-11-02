# Release 0.3 — Implementation Plan

*One product, two tracks; consultation is a project.*

Source: Proposal "Release 0.3", 27 Oct 2026 (owner Mohammad Alkhezi, build
Abdulaziz). This document turns that proposal into milestones against the code
as it stands after 0.2 (`f30fdae`). It follows the conventions in
[IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md): schema changes only as new
migrations, both locales in the same change, gate rules in SQL with a TypeScript
mirror for the pre-submit UI.

---

## Status

Built on `release/0.3`. The schema is in `14491d7`, and the screens and the
removal of the lifecycle follow it. The as-built record is in
[IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), under M15–M17. This
section lists where the build differs from the plan above, and which decisions
were taken without the team.

**Decisions taken with the recommended default** (change any of them in a
migration, not in place):

- Founders are a flag on the team member, set by admins in Settings → Members.
  Gate decisions need it; nothing else does.
- The operator is a name. It is required to pass Gate 1. A team member or a
  contact may be linked as well.
- Gate 1 is decided at Concept and Gate 2 at Venture. Stages move one step at a
  time. Backward moves need a reason.
- Business stage moves are open to the product owner, the business owner, and
  admins. Gate decisions are founders only.
- The Code92 equity share is stored as `code92_equity_pct`.
- Stage status mapping: Plan is Planned; Design, Build and Test are In progress;
  entering Deploy is Ready; entering Maintain is Released.
- Closing Test needs a pass and no open findings. Closing Design needs the spec
  approved only where the policy requires a spec. A stage also needs at least
  one link filed at it, whatever the policy says.
- At Deploy, unmet release checks and open tasks are recorded for medium and
  low risk. High risk needs a written reason to ship with them. This is the
  existing rule, kept.
- The MVP's version label is `MVP`. The migration gives the first existing
  release of a product the MVP's number.
- Project notifications are not part of 0.3, since the proposal does not ask
  for them.
- The project room is archived when the project closes, and unarchived when it
  reopens.
- The sales dashboard sums open value in KWD only.
- The MCP `lifecycle` grant keeps its name, so existing tokens keep working. It
  now covers release evidence and project notes.

**Not done by the build** (needs the team): founders, operators, origination,
ownership and business owners for the six products; the 0.2 and 0.3 cycles for
Code92 Platform (its 0.1 row is now its MVP); and a click-through of the signed-in
screens.

## 1. What already exists — and changes the shape of the work

The proposal reads as if Projects, releases and a gate log were new. Three of
them are partly built, and the plan reuses them rather than adding parallel
tables.

| Proposal concept | Already in the schema | Plan |
|---|---|---|
| Project (consultation) | `engagements` — written by `move_deal_stage()` on a Closed Won consultation deal, with code `ownership`. **0 rows live.** | Rename `engagements` → `projects` and extend it. No data to move, and the Sales win path keeps working. |
| Release entity | `product_releases` + `release_checks` (seeded by risk tier) + `release_transitions` (append-only) + `advance_release_status()`. 1 row live. | Extend `product_releases` with the loop. `release_checks` becomes the Deploy stage's checklist. `status` becomes derived from the stage. |
| Governance gate log | `phase_transitions` (lifecycle) and `release_transitions`, read by `/governance`. | Add `business_stage_transitions`. One `governance_gate_log` view unions all three, with old lifecycle rows kept as history. |
| Customers of a product | `account_products`, written by a Closed Won product deal. | Read it as is on the Business tab. |
| Product-level lifecycle | `product_lifecycle_phases`, `phase_artifacts`, `phase_transitions`, `advance_lifecycle_phase()`, `products_seed_lifecycle` trigger, `product_tasks.lifecycle_phase`. | Retired (§3, M15e). The tables stay read-only as history. Nothing writes to them again. |

The lifecycle is wired into more than the product page. Retiring it touches all
of these:

- **Screens:** `/governance` (CoverageTable, GateLogTable), the dashboard
  (`ProductCard`, `LifecycleBarCompact`), `/products`, `/tasks`, `/my-work`,
  `/knowledge` (provenance chips), and the task editor's phase picker.
- **Waiting on me:** `my_waiting_on()` produces `gate_ready` items from lifecycle
  phases.
- **Agents:** the `lifecycle_advance` proposal action in `lib/agents.ts`,
  `functions/thread-agent.ts` and `functions/agent-runtime.ts`.
- **MCP:** the lifecycle tools in `lib/mcp/tools.ts`.
- **GitHub sync:** `functions/github-sync.ts` generates `LIFECYCLE.md` from
  phases and artifacts.

**Live data** (queried 27 Oct 2026). This is small enough that the migration is
cheap. Do it now, before the data grows.

| Product | Market stage | Lifecycle | Releases |
|---|---|---|---|
| Code92 Platform | beta | Monitor in progress (all earlier phases complete) | 1 (v0.1, in progress) |
| Jadawel | beta | Code & Testing, Deploy and Monitor all in progress | 0 |
| Cliko Platform | beta | Ideation in progress | 0 |
| Code92 Website | idea | Ideation in progress | 0 |
| AI Marketing Agency | idea | Ideation in progress | 0 |
| SAM Digital Platform | idea | Ideation in progress | 0 |

There are 0 deals and 0 engagements.

---

## 2. Decisions needed before building

Each decision has a recommendation, and the plan below assumes it. If you change
one, the milestone it names changes with it.

1. **Who counts as a "founder" for gate decisions?** Today `team_members` has
   only `admin` and `member` roles.
   *Recommend* a `team_members.is_founder` flag that admins set. Gate decisions
   are recorded only by founders. (M15a)
2. **Who is the operator?** An operator is often external: someone
   operator-brought, not on the team.
   *Recommend* `operator_name` (required to pass Gate 1), with an optional link
   to a team member (`operator_user_id`) or a Sales contact
   (`operator_contact_id`). (M15a)
3. **What happens to `products.stage`** (idea / development / beta / live /
   paused / sunset)? It becomes a third axis that the business stage
   contradicts.
   *Recommend* hiding it in the UI. Status updates keep setting `health` only.
   Keep the column for history. (M16b)
4. **Who approves the spec at Design?** "Product owner" could mean
   `products.owner_id`, which exists today, or the new business owner.
   *Recommend* `products.owner_id` or an admin. The approver is recorded, and a
   self-approval is flagged the way lifecycle waivers already are. (M15b)
5. **Release identity.** *Recommend* `release_number` (0 = MVP, then 1, 2, …,
   unique per product) beside the existing free-text `version`. (M15b)
6. **How to migrate the odd cases.** *Recommend* the earliest incomplete phase
   decides the stage. That puts Jadawel at Release 0 · Build.
   - **Cliko Platform** is beta in the market but at Ideation in the lifecycle.
     The rule would give it no release and business stage Idea. Confirm this
     during seeding.
   - **Code92 Platform** gets Release 0 marked shipped, per the proposal. Its
     existing `v0.1` row should become Release 1, with 0.2 recorded as Release 2
     (shipped) and 0.3 as Release 3 (Plan). Confirm.
7. **Default artifact policy** (editable later in Governance settings). See the
   table in M15b.

---

## 3. Build sequence

The schema comes first and is tested in SQL. Then the UI, one module at a time.
The lifecycle retirement comes last, once the new tracks it is replaced by
exist. Each milestone is one commit at minimum and leaves the app working.

Sizes: S ≈ half a day, M ≈ 1–2 days, L ≈ 3+ days.

### M15a — Business track schema · L

Migration `2026110…_add-product-business-track.sql`:

- **New `products` columns:**
  - `business_stage`: `idea | concept | build | venture | company | board`,
    default `idea`. Updated only through the move function, so it has no UPDATE
    grant.
  - `origination`: `discovery | operator_brought | bench_built`.
  - `ownership`: `code92_full | co_owned | client`, plus `equity_split`
    (numeric, required when `co_owned`).
  - Operator: `operator_name`, `operator_user_id`, `operator_contact_id`.
  - `business_owner_id` and `sector`.
- `team_members.is_founder`, with `admin_set_member()` extended to set it.
- `product_watchers`. Same shape and rule as `deal_watchers`: you may add or
  remove only yourself.
- `product_gate_decisions` (append-only):
  - Columns: `product_id`, `gate` (1 or 2), `decision` (`go` or `no_go`),
    `decided_on`, `decided_by` (must be a founder), `note`.
  - Gate 2 adds `pmf_criteria` (text) and `evidence` (knowledge item ids and
    links).
- `business_stage_transitions` (append-only): `from_stage`, `to_stage`,
  `actor_id`, `reason`, `gate_decision_id`, `created_at`.
- `move_business_stage(p_product_id, p_to_stage, p_reason)` is the only stage
  writer. It is `SECURITY DEFINER` and modelled on `move_deal_stage()`.
  - Backward moves require a reason.
  - **Gate 1:** moving from `concept` to `build` requires an operator and a
    latest Gate 1 decision of `go`.
  - **Gate 2:** moving from `venture` to `company` requires a latest Gate 2
    decision of `go`.
  - Passing Gate 1 creates Release 0 if none exists (M15b provides the insert).
- `record_gate_decision(...)`, callable by founders only.
- `product_stage_checklist_items` (`product_id`, `stage`, `label`, `position`,
  `done_at`, `done_by`). On product insert it is seeded from
  `business_checklist_defaults(stage)`, and existing products are backfilled. The
  checklist guides but never blocks.
- `knowledge_item_products` gains `track` (`business | development`, nullable)
  and `release_id` (nullable, same product). The Knowledge tab filters on both,
  and the Business tab lists `track = 'business'`.
- `lib/business-track.ts` mirrors the stages, gates and defaults. Change both
  together.

*Tests:* `tests/sql/50_business_stages.test.sql`:
- Forward and backward moves, including that a backward move needs a reason.
- Gate 1 blocks without an operator and blocks without a go decision.
- Gate 2 blocks without a decision.
- A non-founder cannot decide a gate.
- Every move writes a transition row.

### M15b — Release development loop schema · L

Migration `2026110…_add-release-loop.sql`:

- **New `product_releases` columns:**
  - `release_number` (int, unique per product; 0 = MVP).
  - `kind`, generated: `mvp` when the number is 0, otherwise `cycle`.
  - `goal` (one line) and `success_criteria`.
  - `stage`: `plan | design | build | test | deploy | maintain`, default
    `plan`.
  - `risk_tier`: copied from the product at insert, and admin-only to change
    after that (the same guard the product has today).
- **`status` is now derived, not chosen.** `move_release_stage()` writes it:

  | Stage | Status |
  |---|---|
  | plan | `planned` |
  | design, build | `in_progress` |
  | test closed | `ready` |
  | deploy closed | `released` (sets `released_at`) |

  `cancelled` and `rolled_back` stay available through a narrowed
  `advance_release_status()`. Keeping the status vocabulary means
  `release_overview`, the MCP release tools and the assistant keep working
  unchanged.
- `release_artifact_policy` (`risk_tier`, `kind`, `stage`, `artifact_key`,
  `required`). It is seeded with the defaults below, and admins edit it from
  Governance.
- `release_required_artifacts`: a snapshot of the policy taken at release
  creation. This follows the `release_checks` rule that the checklist a release
  was held to is part of its record.
- `release_artifacts` (`release_id`, `stage`, `artifact_key`, `url`,
  `commit_ref`, `title`, `created_by`). Artifact keys:

  | Stage | Keys |
  |---|---|
  | Plan | `intent` |
  | Design | `spec`, `plan` |
  | Build | `pull_request` (many) |
  | Test | `test_results`, `review_findings` |
  | Deploy | `release_tag`, `deploy_checklist` |
  | Maintain | `incident`, `metric` |

- **Stage-specific fields on the release:**
  - Design: `spec_approved_by` and `spec_approved_at`, through
    `approve_release_spec()`.
  - Test: `test_result` (`pass` or `fail`), `findings_open` and
    `findings_closed`.
  - Maintain: `carry_to_next` on `incident` and `metric` artifacts. When the
    next release is created, its intent lists them.
- `release_transitions` gains `from_stage`, `to_stage`, `artifact_id` and
  `note`. Stage moves log there, so there is one log per release.
- `move_release_stage(p_release_id, p_to_stage, p_note)`:
  - A forward move needs at least one artifact link on the stage being closed,
    plus every required key from the snapshot.
  - Closing Design needs the spec approval.
  - Closing Deploy also needs the required `release_checks`. This reuses the
    existing check, with the same high-risk waiver rule.
  - A backward move needs a note.
- `create_release_zero(product_id)` is called by `move_business_stage()` on Gate
  1. Cycles are created by hand with the version, goal and target date.
  Creating a release while the product has not passed Gate 1 is rejected.
- `lib/releases.ts` is extended to mirror the loop, the policy and the
  status-from-stage map.

The default policy below needs review. The rule "a link is required to close any
stage" applies everywhere, and the table lists what is required on top of it.

| Tier | Release 0 (MVP) | Cycle |
|---|---|---|
| low | intent · spec · PR · test results · release tag | intent · PR · release tag |
| medium | the low set plus `plan`, spec approval, `review_findings` and `deploy_checklist` | intent · spec · PR · test results · release tag |
| high | the medium set plus threat model (Design), security review (Test) and the existing high-risk `release_checks` | the medium cycle set plus spec approval and `review_findings` |

*Tests:* `tests/sql/60_release_loop.test.sql`:
- A stage cannot close without a link, or without a required key.
- Design cannot close without approval.
- Status is derived correctly from each move.
- Backward moves need a note.
- Gate 1 creates exactly one Release 0, and passing it a second time creates no
  duplicate.
- A cycle is rejected before Gate 1.
- The policy snapshot is unaffected by later edits to the policy.

### M15c — Projects schema · L

Migration `2026110…_add-projects.sql`:

- **`ALTER TABLE engagements RENAME TO projects`.** RLS, grants and the
  `deal_id` FK move with it. `ownership` is kept as the project's code
  ownership. New columns:
  - `owner_id` (defaults to the deal owner), `start_date`, `target_end_date`.
  - `phase`: `kickoff | discovery | delivery | handover | closed`.
  - `outcome_note` (required when closed) and `created_by`.
- `project_members`, `project_watchers`, and `project_activities`
  (`created | phase_change | note | field_change`). The activities table is a
  copy of `deal_activities`, and it is the project log.
- `move_project_phase(p_project_id, p_to_phase, p_note)`. Every move is logged
  with the actor and an optional note. Moving to `closed` requires an outcome
  note.
- **`move_deal_stage()`:** a consultation deal moved to Closed Won now inserts a
  project in `kickoff`, owned by the deal owner, on the deal's account. It still
  takes `p_ownership`.
- **Project channel:** `channels.kind` gains `project`, and `project_id` is added
  with the binding constraint updated. A `projects_sync_channel` trigger creates
  the channel and follows the project's name and archive state, the same way
  `products_sync_channel` does.
- **Tasks:** `product_tasks.project_id` (nullable). It cannot be set together
  with `product_id`. `validate_product_task()` is restated in full, as in
  `add-general-tasks`: a parent must belong to the same project, and a release
  only goes with a product.
- `knowledge_item_projects` link table, for the project's deliverables.
- **Capture idea:** `project_products` is the two-way link. It is written by
  `capture_project_idea(p_project_id, p_name, p_problem)`, which creates a
  product at business stage `idea` with origination `discovery`.
- **`project_overview` view.** `is_stale` is true when there has been no task
  change and no activity for 14 days, measured on the Kuwait calendar day
  (`business_today()`).
- **Notifications:** add `project_assigned` and `project_phase` types, and give
  `linkFor` / `notificationHref` a project route. This is optional, but cheap
  given the 0.2 machinery. Drop it if the proposal should stay literal.

*Tests:* `tests/sql/70_projects.test.sql`:
- Phase moves are logged, and closing needs an outcome note.
- A consultation won in Sales opens a project in Kickoff with the right owner,
  and re-winning creates no duplicate.
- A task cannot have both a product and a project.
- Capture idea creates the two-way link.

### M15d — Projections for dashboard, governance and waiting-on · M

Migration `2026110…_add-0-3-projections.sql`:

- `governance_gate_log` (view, `security_invoker`). It unions:
  - business stage moves and gate decisions,
  - release stage moves, and
  - legacy `phase_transitions`, labelled `lifecycle (retired)`.
- `dashboard_strips()`: one RPC returns all four strips. The count of round
  trips matters, because each one costs about 200 ms from the Gulf (see
  DEPLOY.md). The strips:
  1. Products per business stage, plus how many are pending each gate.
  2. Releases in flight per stage, plus how many are overdue.
  3. Projects per phase, plus how many are stale.
  4. Sales: deals per stage, open value, closing this month, stale.
- `dashboard_attention()`: gates pending a decision, releases past their target,
  stale projects, products with no business owner, and products past Gate 1 with
  no operator.
- `my_waiting_on()` is rewritten:
  - `gate_ready` (lifecycle) is replaced by `business_gate_pending` (for
    founders), `release_spec_approval` (for the product owner) and
    `release_stage_ready` (for the release owner, when the stage's artifacts are
    all present).
  - The other item kinds are unchanged.

*Tests:* `tests/sql/30_waiting_on_me.test.sql` is updated, and
`80_dashboard.test.sql` is added.

### M15e — Lifecycle retirement and data migration · M

Migration `2026110…_retire-product-lifecycle.sql`:

- **Stop all writes to the lifecycle.**
  - Drop the `products_seed_lifecycle` trigger.
  - `advance_lifecycle_phase()` and `set_lifecycle_phase_details()` now raise
    `lifecycle retired; use release stages`.
  - Revoke INSERT on `phase_artifacts`.
- **Backfill the business track.**
  - A product with development started goes to business stage `build`, with a
    Gate 1 decision recorded as `go` and the note *"backfilled from the 0.2
    lifecycle"*, by the migrating admin.
  - Everything else goes to `idea`, or to `concept` if Requirements was started.
  - Operators are left empty, so they show in the attention list until seeded.
- **Release 0 for products with development started.** The stage is set by the
  earliest incomplete phase:

  | Earliest incomplete phase | Release 0 stage |
  |---|---|
  | Requirements | plan |
  | Plan | design |
  | Code & Testing | build |
  | Deploy | deploy |
  | Monitor | `maintain`, with `released_at` set (shipped) |

  - Any `phase_artifacts` move onto Release 0 as `release_artifacts`. Ideation
    and Requirements artifacts go to `intent`, Plan to `spec`/`plan`, Code &
    Testing to `test_results`, Deploy to `deploy_checklist`, and Monitor to
    `metric`.
  - Knowledge mirrors keep their `source_artifact_id`, so provenance still
    resolves.
- Open tasks with a `lifecycle_phase` on a product that now has Release 0 get
  `release_id` set to Release 0. The column stays, unused.
- The live special cases (Code92 Platform's existing `v0.1`, and Cliko) are
  handled in the seed step (M17), not in SQL.

*Tests:* `tests/sql/90_lifecycle_migration.test.sql` builds fixtures for each
lifecycle shape, including Jadawel's, and asserts the release, the stage, the
artifacts and the business stage.

### M16a — Projects UI · L

- **Navigation:** Pipeline → **Projects** (`/projects`) in `AppShell`. On
  mobile, Projects goes under More, not the bottom bar. Seven tabs is already
  the noted limit.
- **`/projects` list:**
  - Filters by owner, account and phase, read from the URL query so dashboard
    links land pre-filtered.
  - A stale chip on stale projects.
  - List view first.
- **`/projects/new`:** account (required), name, owner, dates and members.
- **`/projects/[id]`:**
  - Header: account, owner, phase stepper, dates and code ownership.
  - Panels for deliverables (Knowledge links) and tasks, which reuses the My
    work list and kanban scoped by `project_id`.
  - The channel inline, plus the log (`ActivityLog`, reused from Sales) and
    watchers.
  - A phase-move dialog, which requires an outcome note for Closed.
  - **Capture idea:** a button that opens a dialog for the name and problem
    statement, creates the product, and links to it.
- **Sales:** `EngagementsPanel` becomes `ProjectsPanel` on the account and deal
  pages. `StageMoveDialog` keeps the ownership prompt and adds the line
  "creates a project in Kickoff".
- `lib/actions/projects.ts`, plus `projects` namespaces in `messages/en.json`
  and `messages/ar.json`, and in `i18n/request.ts`.

### M16b — Product page: header, tabs and Business · L

- `/products/[id]` becomes a header plus tabs, selected by `?tab=` and rendered
  on the server. Each tab fetches only its own data, so the page gets lighter
  than today's single long page.
- **Header:** name, description, business stage, current release and its stage,
  operator, business owner, ownership and health. The market `stage` chip goes
  (decision 3).
- **Business tab:**
  - A business-stage stepper with the gate markers.
  - A move dialog: a reason when moving backward, and when a gate blocks, the
    missing items listed.
  - Gate 1 and Gate 2 decision dialogs, for founders only.
  - Gate records, the stage checklist (editable), and business documents
    (Knowledge with `track = 'business'`).
  - Customers, from `account_products`.
- **Product form:** origination, ownership with the equity split, the operator
  picker, business owner and sector.
- **Other tabs:** Sales, Tasks (filter by release), Knowledge (filter by track
  and release) and Channel. These wrap the existing `ProductTasksPanel`,
  `ProductKnowledgePanel` and `ProductChannelsPanel`, plus a filtered
  `DealsTable`.
- **Products list:** a business-stage column and filter, with `?business_stage=`
  for links from the dashboard.

### M16c — Development tab, release page and governance settings · L

- **Development tab:** the releases list with Release 0 first, a summary card for
  the current release, the repository link (`RepoConnectCard` moves here), and
  "New cycle". The cycle form takes the version, goal and target date, and
  pre-fills the intent from items carried over by the previous release.
- **`/releases/[id]` is rebuilt around the loop:**
  - Header: product, version, release number, goal, target date, stage and risk
    tier.
  - A six-stage strip. Each stage shows its required artifacts, the links added
    so far, and the approval (Design) or the result (Test).
  - An "Add artifact link" form for each stage, and a move-stage dialog that
    lists what is missing.
  - Tasks for this release (the existing `ReleaseScopePanel`) and the log.
- **`/releases` board:** grouped by stage instead of status, with `?stage=` and
  an overdue filter.
- **Governance settings** (admin): an editor for the artifact policy matrix
  (tier × MVP/cycle × stage).
- `ReleaseStatusControl` shrinks to Cancel and Roll back only.

### M16d — Dashboard strips · M

- `app/[locale]/page.tsx` swaps the six-card `ProductCard` grid for four strip
  rows (a new `components/dashboard/Strip.tsx`) and an attention list. This is
  two RPCs in parallel.
- Every count is a link to its filtered view: `/products?business_stage=…`,
  `/releases?stage=…`, `/projects?phase=…` and `/sales?stage=…`.
- `ProductCard`, `LifecycleBarCompact` and the dashboard `types.ts` are removed
  once nothing else uses them.

### M16e — Lifecycle removal from code, plus agents, MCP and assistant · M

- Delete `components/lifecycle/*` except `RepoConnectCard` and `RiskTierChip`.
  Also delete `lib/lifecycle.ts`, `lib/lifecycle-upload.ts`,
  `lib/actions/lifecycle.ts`, and the lifecycle parts of
  `lib/lifecycle-queries.ts`.
- `/governance`:
  - GateLogTable reads `governance_gate_log`.
  - CoverageTable becomes release-artifact coverage per release: required,
    present and missing.
- **Tasks:** the editor's phase picker becomes a release picker plus a project
  picker. `/tasks` and `/my-work` group by product or project.
- **Agents:** retire the `lifecycle_advance` action. Existing pending proposals
  are expired by migration, and new ones are rejected. The agent context reads
  business stage and release stage instead of `product_lifecycle_phases`. This
  means redeploying `thread-agent` and `agent-runtime`.
- **MCP:** replace the lifecycle tools with business-stage, release-stage and
  project tools. These are read tools, plus one write each for adding an
  artifact link and a project note, behind the existing per-token permissions.
- **Assistant:** add projects and business stage to the context in
  `lib/assistant/context.ts`.
- **`notify-email`:** add project links in `linkFor`, and redeploy (only if the
  M15c notifications are kept).
- **`github-sync`:** leave it deployed as it is. Its `LIFECYCLE.md` path becomes
  unreachable from the UI. Git events are rewired in 0.4.

### M17 — Seed, verify, ship · M

1. **Tests:**
   - `npm run test:sql` (all suites from 10 to 90), `npm test`, `npm run lint`
     and `npm run build`.
   - Unit tests for the TypeScript mirrors: business stages and gates, the
     release loop and the status map, and the project phases.
   - Extend the Playwright smoke from 0.2. It should cover:
     - Project creation, both directly and from a won consultation deal.
     - Capture idea.
     - Both gate blocks and both passes.
     - Release 0 appearing on Gate 1.
     - A full six-stage loop on a cycle.
     - Dashboard links.
     - EN and AR, at desktop width and 360 px.
2. **Backup:** `db export --include-functions --include-sequences
   --include-views -o ../backups/pre-release-0.3-<stamp>.sql`. Backups are not
   available on this backend.
3. **Deploy:**
   - `db migrations up --all -y`.
   - Redeploy `thread-agent` and `agent-runtime`, and `notify-email` if it
     changed.
   - `deployments deploy .`.
   - No new secrets or schedules.
4. **Seed (team, in the app):**
   - Enter the current consultation projects.
   - Set the business stage, origination, ownership and business owner on all
     six products, and name operators where known.
   - Resolve decision 6: Code92 Platform's release history, and Cliko's stage.
   - Mark founders.
5. **Docs and release notes:**
   - A `RELEASES[0]` entry for 0.3 in `lib/platform-releases.ts` (EN and AR),
     and `package.json` version `0.3.0`.
   - An M15–M17 entry in `IMPLEMENTATION_PLAN.md`, and a "Release 0.3" section
     in `DEPLOY.md`.
   - Post a status update on the Code92 Platform product.

---

## 4. Order and dependencies

```
M15a business ─┬─► M15b releases ─┐
               │                  ├─► M15d projections ─► M15e retire+migrate
M15c projects ─┘                  │
                                  ▼
             M16a projects UI   M16b product tabs ─► M16c release loop UI
                         └──────────┴──────► M16d dashboard ─► M16e cleanup ─► M17
```

- M15b depends on M15a, because Gate 1 creates Release 0.
- M15c is independent of both and can run in parallel with them.
- On the UI side, M16a can start as soon as M15c lands.

Rough total: about 3–4 weeks for one builder. Most of the risk is in M15e and
M16e, where existing behaviour is removed, not in the new modules.

## 5. Risks

- **Two state machines on one release row.** Mitigation: only
  `move_release_stage()` writes `status`, and a SQL test asserts the mapping for
  every move.
- **Lifecycle consumers missed.** The list in §1 is from a grep across
  `app components lib functions`. Re-run it before M16e:
  `grep -rlE "lifecycle|phase_artifacts|phase_transitions" app components lib functions`.
- **Mobile navigation.** Projects adds an eighth destination. It goes in More,
  not the bottom bar.
- **Region move** (DEPLOY.md) still gets more expensive with every release. Doing
  it before 0.3's migrations would mean replaying one fewer batch on the new
  project.

## 6. Out of scope (as the proposal states)

These are for 0.4 or later:

- Git-driven stage advancement, PR and CI status, artifact SHA verification, and
  governance checks against the real repository.
- Global search, an in-app notification centre, and health derived from
  activity.
- A quantitative definition of PMF.
- An operator and talent bench module.
- A financial model per product.
