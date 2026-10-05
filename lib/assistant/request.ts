import {AssistantError} from './runtime';
import {MAX_ASSISTANT_BODY_BYTES} from './attachments';

export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    throw new AssistantError('invalid');
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AssistantError('invalid');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readChatBody(request: Request): Promise<unknown> {
  const body = await readBoundedBody(request, MAX_ASSISTANT_BODY_BYTES);
  try {return JSON.parse(new TextDecoder().decode(body));}
  catch {throw new AssistantError('invalid');}
}
