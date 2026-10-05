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

1. **Settings → MCP access** → name the token, choose *Read only* or
   *Read & write* and an expiry (30, 90 or 365 days) → **Create token**.
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

Revoke a token from the same panel. Each member may hold 10 active tokens.

## What a client can do

The tools are the workspace assistant's — same names, same zod schemas, same
executor (`lib/assistant/tools.ts`) — so the two cannot drift apart.

| Tool | Token |
| --- | --- |
| `list_records` — products, tasks, members, releases (paginated) | read, write |
| `search_knowledge`, `read_knowledge` | read, write |
| `create_task`, `update_task` | write |
| `post_status_update` | write |
| `create_knowledge_note` (always a draft) | write |

There are no tools for deletion, membership, waivers, shipping, publishing or
commits. Read results include absolute links back into the app.

## How authorisation works

```
client ──Bearer c92_…──▶ /api/mcp
                           │ sha256(token)
                           ▼
              resolve_mcp_access_token()      (admin client, SECURITY DEFINER,
                           │                   revoked from every client role)
                           │ owner, scope — only if unrevoked, unexpired and
                           │ the owner is still an active member
                           ▼
              sign a 5-minute HS256 JWT for that owner (INSFORGE_JWT_SECRET)
                           │
                           ▼
              runWithAccessToken(jwt, …) → the assistant's tool executor and
              the existing Server Actions, under the owner's RLS
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
  authorised from scratch and answered with JSON. Bodies are capped at 256 KB;
  each token is limited to 120 requests a minute per server instance.

## Setup

1. Apply `migrations/20261005200000_add-mcp-access-tokens.sql`.
2. Set two **server-only** variables on the deployment (never `NEXT_PUBLIC_`):
   - `INSFORGE_API_KEY` — already required by the assistant settings.
   - `INSFORGE_JWT_SECRET` — from `npx @insforge/cli secrets get JWT_SECRET`.
     This secret can sign a session for any user; treat it like the API key.
3. Redeploy. Until both are present the panel says so and `/api/mcp` answers
   503.

## Validation

`tests/mcp.test.mjs` covers token format and hashing, the JWT claims and
signature, read/write tool scoping, protocol handling (initialize, version
negotiation, notifications, batches, errors), the route's auth paths, body and
rate limits, the cookie bypass, and the token actions.
