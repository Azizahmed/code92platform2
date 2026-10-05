# Workspace assistant

The authenticated app shell includes a chat dock on the physical right side in
English and Arabic. It starts minimized on every screen size; use the Assistant
button to open it. Minimize it with the close button
or Escape. Conversations survive client-side navigation and minimizing, and
reset on reload, sign-out, or New conversation.

## Connect a provider

Active administrators can configure the assistant in **Settings → Admin →
Workspace assistant**. Enter a public HTTPS provider API base URL, a model that
supports function calling, and that provider's API key. Save, then use **Test
saved connection** to make one small model call without workspace data or actions.
Saved settings apply to the next request without restarting or redeploying.
Keys are never returned to the browser. Leaving the key blank preserves it only
when the provider URL stays the same; changing that URL requires a new key.
To analyze image attachments, the selected model must also support vision.

The settings store needs migration
`20261005110644_add-assistant-settings.sql` and two **server-only** variables:
`INSFORGE_API_KEY` (project admin key, used only for the settings singleton) and
`ASSISTANT_SETTINGS_ENCRYPTION_KEY` (64 hex characters, generate once with
`openssl rand -hex 32`). Preserve the encryption key across deploys; losing it
requires entering the provider key again. Database access is denied to browser
roles, and API keys are encrypted using AES-256-GCM.

For an optional environment fallback, copy these variables from
[.env.example](.env.example) into `.env.local`, keeping the existing backend settings:

```dotenv
ASSISTANT_BASE_URL=https://your-provider.example/v1
ASSISTANT_MODEL=your-tool-capable-model
ASSISTANT_API_KEY=your-provider-key
```

The base URL must include the API prefix, without `/chat/completions` at the
end. The app appends that path and uses bearer authentication. For OpenAI the
base is `https://api.openai.com/v1`; for OpenRouter it is
`https://openrouter.ai/api/v1`. Select a model that supports Chat Completions
function calling. The implementation follows the
[official function-calling contract](https://developers.openai.com/api/docs/guides/function-calling)
to send tool definitions, execute requested functions, and return their results
to the model.

Restart or redeploy after changing environment variables. Admin-saved settings
take precedence; clearing them restores any environment fallback. This assistant is separate from the
OpenRouter connection saved in Settings for channel agents; that encrypted key
is owned by the edge functions and is not readable by the Next.js server.
Platform reads and writes still use the member's own client and RLS.

## Attachments

Use the paperclip button to select up to three files (2 MB total per message):
PNG, JPEG, WebP, PDFs with selectable text, or UTF-8 text such as TXT, Markdown,
CSV, JSON and YAML. Images have thumbnail previews; selected files can be removed
before sending. A message can contain only attachments, in which case the user
asks the assistant to review them. Files remain available for recent follow-up
questions and are cleared on New conversation, reload or sign-out.

`/api/assistant/attachments` authenticates an active member and prepares one file
at a time without storing it in the database, storage bucket or knowledge base.
Documents contribute up to 12,000 characters; PDF extraction visits at most 50
pages. Excerpts are marked in both the UI and model context. Scanned/image-only
PDFs and locked or unreadable files show an error; use a screenshot for scanned
pages. PDF charts and embedded images are not extracted. Office files, SVG and
archives are unsupported; export documents to PDF or text first.

Images use inline Chat Completions `image_url` content parts following the
[official vision input format](https://developers.openai.com/api/docs/guides/images-vision).
Extracted document text uses ordinary text content parts, keeping document
questions compatible with text-only providers. Attachment contents are reference
data and cannot authorize platform actions. Attachments stay in browser memory
and are sent to the chosen provider with the user's conversation request.

Each chat request contains at most six attachment references, 2 MB of image/text
data and 60,000 text characters. Oldest messages are dropped from the model
request when these limits are reached, while their conversation entries remain
visible. The chat JSON body is bounded at 3.4 MB, including base64 overhead;
the multipart preparation body is bounded before parsing.

## Supported work

| Capability | Behavior |
| --- | --- |
| Explain the platform | Built-in guide to dashboard, products, tasks, releases, knowledge, channels, governance and settings. |
| Read workspace data | Paginated products, tasks, active members and releases, under the caller's RLS context. |
| Search knowledge | Existing bilingual full-text search and individual note/article content. |
| Create tasks | General or product work, optional assignee, due date, notes and parent task. |
| Update tasks | Change only requested fields; complete/reopen tasks and add completion notes. |
| Post product status | Append a status update using the existing action and database triggers. |
| Draft knowledge | Create a draft note, optionally linked to products. |

For example: “Show my open tasks”, “Move the launch checklist due date to
October 8”, or “Create a general task called Review onboarding”. The assistant
looks up record IDs and asks when a requested target is ambiguous. It has no
tools for deletions, membership changes, shipping, waivers, publishing notes,
or repository commits. Those workflows remain on their existing pages.

## Request behavior

- `/api/assistant` requires a same-origin request and an active member. Its
  middleware refreshes the existing cookie-based session before authorization.
- Reads use `createInsForgeServerClient`, never an admin client. Writes reuse
  the project's authenticated actions, validation, RLS, triggers and page
  revalidation. `patchTaskAction` updates only supplied fields.
- Provider keys stay on the server. The configured provider receives the chat,
  platform guide, current user ID/page and data returned by the selected tools.
  Chat contents are kept in component memory, not browser storage or a new table.
- The response streams newline-delimited progress and action results, followed
  by the final answer. Completed writes have a View link; affected app data is
  refreshed even if a later model call fails.
- Each turn permits six model calls and twelve tool calls, with a 110-second
  deadline. Identical successful writes within that turn are reused. The API
  rejects overlapping turns per user on the same server instance; this is not a
  distributed rate limiter or cross-request idempotency store.
  Input history (including extracted document text) is capped at 60,000 characters and accumulated model context
  at 120,000 characters.
- No requests or writes are automatically retried. If a connection drops during
  an action, check the workspace before repeating it. A closed browser stream
  cannot undo an already committed database operation.

## Validation

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build` with
the existing backend environment settings. Tests execute the real TypeScript
with mocked adapters to cover the provider loop, validated tool dispatch,
partial task writes, RLS-filtered results, route authorization, admission
cleanup and bounded request handling.

The panel was also checked in cloud Chrome using the real React components
with a mocked chat endpoint: desktop/mobile, English/Arabic, navigation
persistence, minimizing, new conversation, action links, provider errors and
fragmented UTF-8 responses. Live model/backend integration needs the provider
and backend credentials, which are not present in this checkout.

## Performance changes in this update

- Channel replies and proposals are indexed once per dataset instead of
  repeatedly filtered per message. Unchanged Markdown bodies are memoized;
  author/mention indexes are reused while typing. Polls skip in-flight refreshes
  and mutation refreshes queue behind them.
- Task statistics use one memoized pass; searchable text is built once per
  task dataset/locale. Deferred filtering keeps typing responsive, and date
  formatting reuses one formatter per locale.
- Dashboard, product registry, knowledge, governance and channel-layout reads
  start alongside their independent auth/translation work. Translation
  namespaces load concurrently. User-specific data is not cached across requests.
- Dashboard queries select only fields rendered in cards, and card reveal
  animations run in CSS with reduced-motion support. Relative-time formatters
  are shared by locale.
- Turbopack's root is fixed to this checkout so a parent lockfile cannot expand
  the workspace it scans.

A synthetic 20,000-message/1,000-group check measured 268.47ms for repeated
filtering and 5.06ms for indexing plus lookups on this machine. This isolates
grouping work; it is not a measured production page-speed improvement. The
regression test verifies one indexing visit per row without a timing threshold.
