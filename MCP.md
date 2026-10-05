# MCP access

The platform is an [MCP](https://modelcontextprotocol.io) server. Any MCP
client that speaks **Streamable HTTP** — Claude Code, Claude Desktop, Cursor,
VS Code, the MCP Inspector — can connect to `https://<app host>/api/mcp` with a
personal access token and work with the workspace as the member who issued it.

This is separate from `services/agent-runner/platform-mcp.mjs`, which is the
stdio server the jcode harness uses inside its sandbox with a run-scoped
capability token. That one is read-only and scoped to one run; this one is for
people and their own clients.

## Connect a client

1. **Settings → MCP access** → name the token, pick an expiry (30, 90 or 365
   days) and tick what it may do (below; *Read only* and *Full access* are
   shortcuts) → **Create token**.
2. Copy the token. It is shown once; only its hash is stored.
3. Add the server to your client. The panel prints both forms:

   ```bash
   claude mcp add --transport http code92 https://<app host>/api/mcp \
     --header "Authorization: Bearer c92_…"
   ```

   ```json
   {
     "mcpServers": {
       "code92": {
         "type": "http",
         "url": "https://<app host>/api/mcp",
         "headers": {"Authorization": "Bearer c92_…"}
       }
     }
   }
   ```

   Clients that only speak stdio can bridge with
   `npx mcp-remote https://<app host>/api/mcp --header "Authorization: Bearer c92_…"`.

Permissions are fixed at creation; to change them, create a new token and
revoke the old one. Each member may hold 10 active tokens.

## Permissions and tools

A client only sees — and can only call — the tools its token was granted. Every
tool is a thin adapter over the Server Action the web app uses
([lib/mcp/tools.ts](lib/mcp/tools.ts)), so validation, RLS, triggers and gate
rules are identical: a permission decides which of the member's *own* abilities
the client may use, never more.

| Permission | Tools |
| --- | --- |
| **read** (always) | `list_records`, `search_knowledge`, `read_knowledge`, `list_tags`, `get_product`, `get_task`, `get_release`, `list_channels`, `read_channel` |
| **tasks** | `create_task`, `update_task` (incl. complete/reopen), `set_task_watch`, `set_task_release` |
| **products** | `create_product`, `update_product`, `post_status_update`, `set_product_risk_tier` |
| **lifecycle** | `update_lifecycle_phase`, `advance_lifecycle_phase` (incl. waivers), `add_lifecycle_artifact` |
| **knowledge** | `create_knowledge_item`, `update_knowledge_item` (incl. publish), `set_knowledge_archived`, `create_tag` |
| **releases** | `create_release`, `update_release`, `advance_release_status`, `set_release_check` |
| **channels** | `post_message`, `create_channel`, `open_direct_message`; also lets the read tools see direct messages |
| **attachments** | `upload_file`, `create_upload_link`, `attach_files_to_task`, `attach_images_to_status_update`, `attach_files_to_message`, `set_product_logo`; also files on knowledge items and lifecycle evidence |
| **delete** | `delete_task`, `delete_status_update`, `delete_knowledge_item`, `delete_release`, `delete_message`, `delete_lifecycle_artifact`, `set_product_archived` |

Partial updates (`update_*`) read the current record and change only the
fields sent. Deletes remove the storage objects the browser would remove.
Workspace administration — members, agents and proposals, GitHub/OpenRouter/
assistant integrations and MCP tokens — has no tools and stays in the browser.

### Files

The browser uploads straight to storage; a client cannot, so the server stores
bytes under the member's own session and returns a **fileId** — a signed record
of what was stored, valid for 24 hours, usable only by that member and only for
the purpose it was uploaded for (`task`, `status_update`, `logo`, `knowledge`,
`message`, `lifecycle`). Attach tools accept fileIds, never raw storage keys.

- `upload_file` — `text` (Markdown, CSV… the agent wrote) or `contentBase64`,
  up to 3 MB.
- `create_upload_link` — a one-off URL valid 15 minutes; the client PUTs the
  raw bytes (`curl --data-binary @file`) to `/api/mcp/uploads` and gets the
  fileId back. Up to 4 MB, the serverless request-body ceiling. Revoking the
  token voids its outstanding links.

Types follow the same allowlist as the app (images, text, PDF, Office);
`status_update` and `logo` take images only.

## How authorisation works

```
client ──Bearer c92_…──▶ /api/mcp
                           │ sha256(token)
                           ▼
              resolve_mcp_access_token()      (admin client, SECURITY DEFINER,
                           │                   revoked from every client role)
                           │ owner, permissions — only if unrevoked, unexpired and
                           │ the owner is still an active member
                           ▼
              sign a 5-minute HS256 JWT for that owner (INSFORGE_JWT_SECRET)
                           │
                           ▼
              runWithAccessToken(jwt, …) → the granted tools → the existing
              Server Actions, under the owner's RLS
```

- **A token never exceeds its owner.** Every query and action runs under the
  owner's JWT, so RLS, column grants and triggers decide exactly as they do in
  the browser. The admin key is used for one call only: resolving a hash.
- **Deactivation is immediate.** Resolution joins `team_members.is_active`, so a
  deactivated member's tokens stop working on the next request.
- **No cookies.** The route never reads them, and the request-scoped token in
  `lib/insforge/server.ts` takes precedence over them in the shared helpers, so
  a cross-site request cannot borrow a browser session.
- **Hash only.** `token_hash` has no grant to any client role, including the
  owner's. Tokens are 256 random bits, so SHA-256 without a salt is sufficient.
- **Stateless.** No session id, no SSE stream (`GET` → 405). Each `POST` is
  authorised from scratch and answered with JSON. Bodies are capped at about
  4 MB; each token is limited to 120 requests a minute per server instance.

## Setup

1. Apply `migrations/20261005200000_add-mcp-access-tokens.sql` and
   `migrations/20261006090000_mcp-token-permissions.sql`.
2. Set two **server-only** variables on the deployment (never `NEXT_PUBLIC_`):
   - `INSFORGE_API_KEY` — already required by the assistant settings.
   - `INSFORGE_JWT_SECRET` — from `npx @insforge/cli secrets get JWT_SECRET`.
     This secret can sign a session for any user; treat it like the API key.
3. Redeploy. Until both are present the panel says so and `/api/mcp` answers
   503.

## Validation

`tests/mcp.test.mjs` covers token format and hashing, the JWT claims, sealed
handles, permission-gated tool listing and calls, delegation to the actions and
partial updates, upload type/size/ownership rules, upload links, storage
cleanup on delete, the routes' auth paths and limits, the cookie bypass, and
the token actions.
