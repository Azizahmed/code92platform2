import {AssistantError} from '@/lib/assistant/runtime';
import {readBoundedBody} from '@/lib/assistant/request';
import {createToolExecutor} from '@/lib/assistant/tools';
import {createInsForgeServerClient, runWithAccessToken} from '@/lib/insforge/server';
import {MAX_MCP_INLINE_UPLOAD_BYTES} from '@/lib/mcp/files';
import {handleMcpBody, SUPPORTED_PROTOCOL_VERSIONS} from '@/lib/mcp/server';
import {mcpToolList, runMcpTool, toolAllowed} from '@/lib/mcp/tools';
import {mcpAvailable, readBearerToken, resolveMcpCaller, signMemberAccessToken} from '@/lib/mcp/tokens';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Streamable HTTP, stateless: every POST carries its own bearer token, is
// authorised from scratch, and is answered with plain JSON. No session id is
// issued and no SSE stream is offered (GET answers 405, as the transport
// allows). Browser cookies are never read here, so a cross-site request cannot
// ride a signed-in session. The body ceiling leaves room for upload_file's
// base64 payload plus its JSON-RPC envelope.
const MAX_BODY_BYTES = Math.ceil(MAX_MCP_INLINE_UPLOAD_BYTES * 4 / 3) + 64 * 1024;

// Local admission control only, per server instance — enough to stop one
// runaway client from monopolising it. RLS remains the authority.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const recent = new Map<string, number[]>();

function admit(tokenId: string, now = Date.now()): boolean {
  if (recent.size > 1000) for (const [id, stamps] of recent) if (stamps.at(-1)! < now - WINDOW_MS) recent.delete(id);
  const stamps = (recent.get(tokenId) ?? []).filter((stamp) => stamp > now - WINDOW_MS);
  if (stamps.length >= MAX_REQUESTS_PER_WINDOW) return false;
  stamps.push(now);
  recent.set(tokenId, stamps);
  return true;
}

function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({jsonrpc: '2.0', id: null, error: {code, message}},
    {status, headers: {'Cache-Control': 'no-store', ...headers}});
}

function unauthorized(invalid: boolean) {
  return rpcError(401, -32001, 'A valid Code 92 MCP access token is required', {
    'WWW-Authenticate': `Bearer realm="code92-mcp"${invalid ? ', error="invalid_token"' : ''}`
  });
}

export async function POST(request: Request) {
  if (!mcpAvailable()) return rpcError(503, -32000, 'MCP access is not configured on this deployment');

  const header = request.headers.get('authorization');
  const token = readBearerToken(header);
  if (!token) return unauthorized(Boolean(header));

  const version = request.headers.get('mcp-protocol-version');
  if (version && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return rpcError(400, -32600, `Unsupported MCP protocol version: ${version.slice(0, 40)}`);
  }

  let caller;
  try {
    caller = await resolveMcpCaller(token);
  } catch {
    return rpcError(503, -32000, 'Token check is temporarily unavailable');
  }
  if (!caller) return unauthorized(true);
  if (!admit(caller.tokenId)) return rpcError(429, -32000, 'Too many requests', {'Retry-After': '60'});

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, MAX_BODY_BYTES)));
  } catch (error) {
    return error instanceof AssistantError
      ? rpcError(413, -32600, 'Request body is empty or too large')
      : rpcError(400, -32700, 'Parse error');
  }

  const origin = new URL(request.url).origin;
  const reply = await runWithAccessToken(signMemberAccessToken(caller.userId), async () => {
    const insforge = await createInsForgeServerClient();
    const context = {insforge, caller, origin, assistant: createToolExecutor(insforge)};
    return handleMcpBody(body, {caller, origin, tools: {
      list: () => mcpToolList(caller.permissions),
      allowed: (name) => toolAllowed(name, caller.permissions),
      call: (name, input) => runMcpTool(name, input, context)
    }});
  });
  if (reply === null) return new Response(null, {status: 202, headers: {'Cache-Control': 'no-store'}});
  return Response.json(reply, {headers: {'Cache-Control': 'no-store'}});
}

export function GET() {
  return new Response(null, {status: 405, headers: {Allow: 'POST'}});
}

export function DELETE() {
  return new Response(null, {status: 405, headers: {Allow: 'POST'}});
}
