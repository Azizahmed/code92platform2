import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {MAX_ASSISTANT_FILE_BYTES} from '@/lib/assistant/attachments';
import {prepareAssistantAttachment} from '@/lib/assistant/prepare-attachment';
import {readBoundedBody} from '@/lib/assistant/request';
import {AssistantError} from '@/lib/assistant/runtime';

export const runtime = 'nodejs';
export const maxDuration = 30;
const active = new Map<string, number>();

export async function POST(request: Request) {
  const errorResponse = (error: string, status: number) => Response.json({error},
    {status, headers: {'Cache-Control': 'no-store'}});
  if (request.headers.get('origin') !== new URL(request.url).origin) return errorResponse('forbidden', 403);
  const [user, member] = await Promise.all([getSessionUser(), getOwnMembership()]);
  if (!user || !member?.is_active) return errorResponse('forbidden', 403);
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data;')) return errorResponse('invalid', 400);
  const now = Date.now();
  for (const [id, expires] of active) if (expires < now) active.delete(id);
  if (active.has(user.id) || active.size >= 16) return errorResponse('busy', 429);
  const expires = now + 35000;
  active.set(user.id, expires);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
    // Bound the multipart stream before formData allocates/parses it.
    const body = await readBoundedBody(request, MAX_ASSISTANT_FILE_BYTES + 16384);
    const form = await new Response(body.buffer as ArrayBuffer, {headers: {'Content-Type': contentType}}).formData();
    const files = form.getAll('file');
    if (files.length !== 1 || [...form.keys()].some((key) => key !== 'file') || !(files[0] instanceof File)) {
      return errorResponse('invalid', 400);
    }
    const attachment = await prepareAssistantAttachment(files[0], signal);
    return Response.json({attachment}, {headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  } catch (error) {
    return errorResponse(error instanceof AssistantError ? error.code : 'fileUnreadable', 422);
  } finally {
    if (active.get(user.id) === expires) active.delete(user.id);
  }
}
