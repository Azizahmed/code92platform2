import {AssistantError} from './runtime';

export async function readChatBody(request: Request): Promise<unknown> {
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > 100000) {
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
      if (size > 100000) {
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
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new AssistantError('invalid');
  }
}
