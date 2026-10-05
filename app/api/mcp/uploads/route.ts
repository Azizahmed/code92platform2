import {AssistantError} from '@/lib/assistant/runtime';
import {readBoundedBody} from '@/lib/assistant/request';
import {createInsForgeServerClient, runWithAccessToken} from '@/lib/insforge/server';
import {MAX_MCP_UPLOAD_BYTES, McpFileError, openUploadTicket, storeFile} from '@/lib/mcp/files';
import {mcpAvailable, resolveMcpCallerById, signMemberAccessToken} from '@/lib/mcp/tokens';

export const runtime = 'nodejs';
export const maxDuration = 60;

// The other half of create_upload_link: an MCP client with a file on disk PUTs
// the raw bytes here instead of pushing them through the model as base64. The
// URL carries a signed, 15-minute ticket naming the member, the token that
// asked and the file's purpose, name and type. The token is re-checked, so
// revoking it (or deactivating the member) voids its outstanding links. The
// bytes are stored under the member's own session, exactly like upload_file.
function reply(status: number, body: object) {
  return Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
}

async function upload(request: Request): Promise<Response> {
  if (!mcpAvailable()) return reply(503, {error: 'notConfigured'});
  const ticket = openUploadTicket(new URL(request.url).searchParams.get('ticket'));
  if (!ticket) return reply(401, {error: 'invalidOrExpiredLink'});

  let caller;
  try {
    caller = await resolveMcpCallerById(ticket.tokenId);
  } catch {
    return reply(503, {error: 'unavailable'});
  }
  if (!caller || caller.userId !== ticket.userId || !caller.permissions.includes('attachments')) {
    return reply(401, {error: 'invalidOrExpiredLink'});
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request, MAX_MCP_UPLOAD_BYTES);
  } catch (error) {
    return error instanceof AssistantError ? reply(413, {error: 'fileSize', maxBytes: MAX_MCP_UPLOAD_BYTES})
      : reply(400, {error: 'invalid'});
  }

  try {
    const stored = await runWithAccessToken(signMemberAccessToken(caller.userId), async () =>
      storeFile(await createInsForgeServerClient(), caller.userId, ticket.purpose,
        {fileName: ticket.fileName, mimeType: ticket.mimeType || undefined, bytes}));
    return reply(201, stored);
  } catch (error) {
    return error instanceof McpFileError ? reply(error.code === 'uploadFailed' ? 502 : 400, {error: error.code})
      : reply(500, {error: 'generic'});
  }
}

export function PUT(request: Request) {
  return upload(request);
}

export function POST(request: Request) {
  return upload(request);
}
