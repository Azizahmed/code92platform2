# Code 92 Command Center — Collaboration Layer

Channels, threads, and a roster of AI agents that work alongside the team inside
the command center rather than beside it.

Companion to [SPECIFICATION.md](SPECIFICATION.md) (§4 functional spec) and
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (build sequence). Design tokens
and RTL rules remain governed by [DESIGN.md](DESIGN.md), with one amendment
recorded in §7.

---

## 1. Purpose

Today the system of record is complete but silent: state changes, nobody talks
about it in place. A Slack-shaped surface is added so the conversation happens
where the data lives, and a roster of agents reads that conversation and turns it
into proposed changes to the record.

**The thesis.** Chat next to a system of record produces drift — decisions get
made in the room and the tables go stale. The counterweight here is not
discipline, it is the agent: its primary job is to notice that a decision was
reached in conversation and to raise the corresponding `status_update`,
`product_task` or `knowledge_item` as a proposal awaiting one click. Chat drift
becomes the agent's input rather than the platform's failure mode.

**Non-goals for v1.** Direct messages, private channels, reactions, huddles,
message search (the knowledge base already has bilingual search), and file
uploads (`task_attachments` and `phase_artifacts` already exist).

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Channels, Slack-style** — plus an auto-created bound channel per product | Familiar to the team; bound channels give agents implicit context and give domain events somewhere to land |
| D2 | **Agents propose, humans commit — always** | The gate model in §4.6 of the spec cannot survive an agent with direct write access |
| D3 | **One InsForge edge function per mention**, mirroring `trend-scan` | Reuses infrastructure already understood and already cost-controlled |
| D4 | **Role-scoped agents** — each has its own allowlist of proposal actions | Containment enforced by schema, not by prompt wording |
| D5 | **Agent schedules are admin-only** | An unattended AI run costs money on its own cadence; same class of decision as activating a member |
| D6 | **OpenRouter is the only gateway; each agent carries its own model slug** | One credential to hold and cap; per-agent model choice without a deploy |

### D2 in detail — why propose-only is not negotiable

`advance_lifecycle_phase` exists because a client-side gate is decoration. An
agent holding write access to that RPC is the same hole reopened from the other
side: it could waive a high-risk gate. Under propose-only, the agent writes a row
to `agent_proposals` and nothing else. The mutation runs when a human approves,
**in that human's auth context**, so RLS and the gate matrix re-derive exactly as
they do for a hand-typed change.

Agents can never, under any configuration: waive a gate, ship a release, activate
a team member, or delete anything.

---

## 3. Schema

```sql
-- Conversation ---------------------------------------------------------------
channels          id, slug UNIQUE, name, name_ar, topic,
                  kind CHECK (kind IN ('standing','product')),
                  product_id UUID REFERENCES products(id),   -- set when kind='product'
                  archived_at, created_by, created_at, updated_at

channel_members   channel_id, user_id, last_read_at, notification_level
                  PRIMARY KEY (channel_id, user_id)

messages          id, channel_id, parent_id REFERENCES messages(id),  -- threading
                  author_id REFERENCES auth.users(id),
                  body TEXT, kind CHECK (kind IN ('human','agent','system')),
                  promoted_to_type, promoted_to_id,          -- what this became
                  edited_at, deleted_at, created_at

message_mentions  message_id, mentioned_user_id
                  -- drives both notifications and agent triggering

-- Agents ---------------------------------------------------------------------
agents            user_id PK REFERENCES auth.users(id),      -- 1:1 with team_members
                  handle UNIQUE, display_name, description,
                  system_prompt,
                  model,                                     -- OpenRouter slug, verbatim
                  allowed_actions TEXT[],                    -- D4 containment
                  temperature, max_output_tokens,
                  enabled, budget_usd_month, created_at, updated_at

openrouter_connection  -- singleton, NO grants to any client role
                  key_ciphertext, key_iv, key_last_four,
                  key_label, key_limit_usd, key_usage_usd, key_is_free_tier,
                  validated_at, validation_error, connected_by

agent_proposals   id, message_id, agent_id, channel_id,
                  action, payload JSONB, reasoning,
                  status CHECK (status IN ('pending','approved','rejected','superseded','expired')),
                  decided_by, decided_at, decision_note,
                  result_type, result_id, created_at

agent_runs        id, agent_id, trigger_message_id, schedule_id,
                  model, prompt_tokens, completion_tokens, cost_usd,
                  status, error, created_at

agent_schedules   id, agent_id, channel_id, product_id, cron, prompt,
                  enabled, last_run_at, next_run_at, created_by, created_at
```

`agents` is a 1:1 sidecar on `team_members`, which gains
`kind TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human','agent'))`. Every
agent is a real `auth.users` row, so `notifications.actor_id`,
`status_updates.author_id`, `phase_transitions.actor` and every existing RLS
policy keep working with no changes.

`phase_artifacts.agent_run_id` — already present and unconstrained since M9 —
finally gets its `REFERENCES agent_runs(id)`.

---

## 4. The proposal protocol

```
  @warden mentioned in #ajwa
        │
        ▼
  messages INSERT ──trigger──▶ agent_runs (status='pending')
        │                            │
        │ Server Action pings        │ agent-tick schedule drains
        │ functions/thread-agent.ts  │ anything the ping missed
        ▼                            ▼
  read thread + bound product context
  one OpenRouter call
        │
        ▼
  messages INSERT (kind='agent')  +  agent_proposals (status='pending')
        │
        ▼
  proposal card renders in the stream:  [ Approve ] [ Edit ] [ Reject ]
        │
        ▼
  decide_agent_proposal(proposal_id, decision, note)
        │
        ├─ action ∈ agent.allowed_actions ?        else reject   (D4)
        ├─ can THIS approver perform this action?  else reject   (D2)
        └─ execute in the approver's auth context
                 │
                 ▼
           domain row written · proposal.result_id set
           message.promoted_to_id set
```

### `decide_agent_proposal` — the load-bearing function

This must **not** be a `SECURITY DEFINER` function that executes the payload. It
re-derives the approver's own authority first, then performs the write as them.
A member approving a proposed lifecycle advance is rejected, not silently
elevated. The Approve button is a permission check, not a rubber stamp.

### Attribution: the approver is the author

`status_updates` has this INSERT policy from M1:

```sql
WITH CHECK (is_active_member() AND author_id = auth.uid() AND source_type = 'manual')
```

An approved proposal is therefore written with `author_id` = the approving human
and `source_type = 'manual'`, with agent provenance recorded in the existing
`source_ref JSONB` column:

```json
{"via": "agent", "agent": "warden", "proposal_id": "…", "message_id": "…"}
```

This is the honest model, not a workaround. The person who clicked Approve is
accountable for the change; the agent's fingerprint is visible but not
load-bearing. No migration to `status_updates` is required.

### The waiver reason is never pre-filled

Per §4.6, a high-risk phase proceeds only when an admin supplies a written
reason, and that reason lands in the waiver register `/governance` reports on. An
agent may propose the *advance*; the reason field arrives empty and is typed by
the approving admin. An AI-drafted justification for waiving a security gate,
attributed to a human, would make the register mean nothing.

---

## 5. Agent roster (D4)

| Agent | Brief | `allowed_actions` |
|---|---|---|
| `@scout` | Market signal in bound product channels | `knowledge_note` |
| `@scribe` | Capture decisions reached in conversation | `knowledge_note`, `task_create`, `task_update` |
| `@warden` | Chase stale phases and unreviewed products | `status_update`, `lifecycle_advance` |

The allowlist is enforced in `decide_agent_proposal`, so a prompt injection that
convinces `@scout` to advance a lifecycle phase still produces a rejected
proposal. Adding an agent is an `INSERT`, not a migration.

---

## 6. OpenRouter (D6)

Every agent calls the same gateway with the same credential. What differs per
agent is the **model slug**, stored in `agents.model` and pasted verbatim from
`openrouter.ai/models` — `anthropic/claude-sonnet-4.5`, `perplexity/sonar`,
`meta-llama/llama-3.3-70b-instruct:free`.

That column is a free-text field with a shape-only `CHECK`, not an enum and not a
dropdown, on purpose: OpenRouter owns that namespace and adds to it constantly,
so a list we maintain would be stale the week after it ships and a new model
would need a migration. An unknown slug fails at call time with OpenRouter's own
error, which is more useful than ours would be.

### The credential

`openrouter_connection` is a singleton with **no grants to `anon` or
`authenticated` in any role** — the same boundary as `github_connection`, for the
same reason: the app only ever builds a per-user client, so anything an admin's
session can `SELECT`, that admin's browser can also pull straight from PostgREST
with the public anon key. The key is AES-GCM encrypted under
`OPENROUTER_KEY_SECRET`, which lives in the function environment and never in the
database. Admins read status through `openrouter_connection_status()`, which
structurally cannot return the ciphertext.

### "Should be a test key", made concrete

The key is validated against `GET /api/v1/key` at save time, which reports the
key's spend limit, usage and free-tier status. A **null limit means uncapped**,
and that is recorded as `key_is_capped = false` and warned about prominently in
Settings.

It is a warning rather than a hard rejection because an org that caps spend at
the account level rather than the key level is not doing anything wrong. What
must not happen quietly is an unattended 03:00 schedule holding an uncapped
production key — so it does not happen quietly.

### Cost

`usage: {include: true}` on every completion asks OpenRouter to return what the
call actually cost, so `agent_runs.cost_usd` records real spend rather than an
estimate from a price table we would have to keep in sync. The budget check reads
month-to-date spend **before** the call, not after.

## 7. Scheduling (D5)

InsForge's `schedules.jobs` is not writable by the app's role — `trend-scan.ts`
records that it is not writable even by the CLI's role. Agents therefore cannot
create InsForge schedules at runtime, and should not: scheduling is owned in our
own schema instead.

**One** InsForge schedule drives everything:

```
agent-tick  (*/5 * * * *)  →  functions/agent-tick.ts
                                SELECT … FROM agent_schedules
                                WHERE enabled AND next_run_at <= now()
                                → enqueue agent_runs, same drain as mentions
```

That single piece of infrastructure is provisioned once and never touched again.
Everything else is rows: RLS on who may schedule (admins), per-agent monthly
budgets checked before each OpenRouter call, a per-job `enabled` flag, and a
global `PIPELINE_ENABLED` kill switch matching the one in `trend-scan.ts`.

Scheduled runs use the identical propose-only path. An unattended agent at 03:00
can leave a proposal and nothing more.

**Cost posture.** `trend-scan` was killed over OpenRouter spend; this subsystem
starts with `agent_runs` recording tokens and cost from the first commit, an
admin-only cost panel, and agents that respond **only** when `@`-mentioned or
scheduled — never ambient on every message.

---

## 8. Cross-cutting amendments

**Realtime.** `insforge.toml` currently sets `realtime.retention_days = 0`, and
`NotificationBell.tsx` documents that it polls at 60s for exactly that reason.
Retention moves above zero and the open channel subscribes. The bell keeps its
poll — it is minutes-matter, its comment stays true, and working code is not
rewritten for symmetry.

**Notifications.** `notifications.type` has a `CHECK` listing only the five
`task_*` types. It gains `mention`, `proposal_pending`, `proposal_decided`, and
the table gains `message_id` / `channel_id` alongside the existing
`task_id` / `product_id`.

**RTL — a documented exception to DESIGN.md.** DESIGN.md states the single RTL
switch is `<html dir>` and that `dir` is never set anywhere else. Chat is
user-generated content: an Arabic message and an English message coexist in one
thread and each must lay out correctly. Message bodies therefore carry
`dir="auto"` on the body element only. This is the sole sanctioned exception; the
surrounding chrome stays governed by the layout switch, and logical-property
rules (`ms/me`, `ps/pe`, `text-start`) apply unchanged.

**i18n.** Chrome strings live in `messages/<locale>/channels.json` and
`agents.json`, both appended to `NAMESPACES` in `i18n/request.ts`. Message bodies
are never translated. Agents reply in the language of the thread.

---

## 9. Build sequence — built

| Milestone | Scope |
|---|---|
| **M13a** | `channels`, `channel_members`, `messages`, `message_mentions` + RLS. Realtime on. Channel list, message stream, threads, unread state. No agents. |
| **M13b** | Notification integration: `mention` type, bell wiring, per-channel notification levels. Auto-created product channels + the domain event feed. |
| **M13c** | `agents`, `team_members.kind`, agent identities provisioned. `agent_runs`, `agent_proposals`, `decide_agent_proposal`. `functions/thread-agent.ts` for `@`-mentions. Proposal card UI. Actions: `knowledge_note`, `task_create`, `task_update`. |
| **M13d** | `status_update` and `lifecycle_advance` proposals, with the empty-waiver rule and admin re-derivation. Governance surfaces agent-authored provenance. |
| **M13e** | `agent_schedules` + `functions/agent-tick.ts`. Admin scheduling UI, budgets, cost panel. `phase_artifacts.agent_run_id` FK, unblocking the automated PSR already reserved in M9. |

M13a is independently useful — a team chat bound to products, shipped before any
agent exists. Each later milestone is additive and independently revertible.

---

## 10. Open risks

- **Prompt injection via channel content.** A message can instruct an agent.
  Containment is `allowed_actions` plus propose-only, not prompt hardening — a
  successful injection produces a proposal a human must still approve. Approvers
  need to see the proposal payload in full, never a summary of it.
- **Approval fatigue.** If agents propose too much, Approve becomes reflexive and
  D2's protection evaporates. Watch the approve/reject ratio; an agent approved
  100% of the time is either trusted or unread, and those look identical.
- **Channel sprawl.** One bound channel per product across a growing portfolio.
  Archive-on-sunset should ship with M13b, not later.
- **Bilingual agent output.** `trend-scan` produces `summary_ar` alongside
  English. Whether agent proposals must carry both languages is unresolved and
  affects the payload schema — decide before M13c.

---

## 11. Verification

The migrations were replayed against a clean Postgres 16 on top of the full
existing chain, then the boundaries were exercised rather than assumed.

**Two real defects were caught this way and fixed before shipping:**

1. `messages_queue_agent_runs()` declared its loop variable as `handle`, which
   PL/pgSQL resolves ambiguously against `agents.handle` — every agent mention
   raised `column reference "handle" is ambiguous` at run time, not at create
   time. Both fan-out functions now use `v_handle`.
2. An agent's own `team_members` row matched the **human** mention path, so
   `@warden` filed a notification for an account that has no inbox and produced
   two mention rows for one mention. The human fan-out now requires
   `kind = 'human'`, which moved `team_members.kind` into part 1 where its first
   consumer lives.

*Verified:* a product insert auto-creates its bound channel; `@warden` queues
exactly one run and one human mention notification; an agent's own message queues
no further run (no agent-to-agent loops); threads reject a second level; an action
outside `allowed_actions` is refused; a non-member cannot decide; **a member
approving a lifecycle advance is refused by `advance_lifecycle_phase` re-deriving
against the approver**; an approved status update is written with the approver as
`author_id`, `source_type = 'manual'` and agent provenance in `source_ref`, moves
the product, and marks the message promoted; the same proposal cannot be approved
twice; and an admin-approved advance recorded `missing_artifacts = {prd}` with an
**empty** `waiver_reason` even though the agent had written
`"waiver_reason": "AI SAYS THIS IS FINE"` into its payload.

The cron parser in `agent-tick.ts` passes 14 cases including step, list and range
fields, the `dom`/`dow` OR rule, `7` as Sunday, the `min_interval_minutes` floor,
and expressions that match nothing (`0 0 30 2 *` raises rather than looping).

**Not yet verified — needs the live backend:** the OpenRouter call path
end-to-end, agent provisioning through `admin.auth.signUp`, and the InsForge
schedule firing `agent-tick`. These need secrets and a deploy (see `DEPLOY.md`).
