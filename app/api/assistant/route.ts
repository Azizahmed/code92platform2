import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {platformPrompt} from '@/lib/assistant/context';
import type {AssistantEvent} from '@/lib/assistant/protocol';
import {readChatBody} from '@/lib/assistant/request';
import {AssistantError, runAssistant} from '@/lib/assistant/runtime';
import {loadAssistantProviderConfig} from '@/lib/assistant/settings';
import {assistantTools, chatRequestSchema} from '@/lib/assistant/schemas';
import {createToolExecutor} from '@/lib/assistant/tools';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Avoid overlapping agent turns for one user on this server instance. The
// expiry also bounds memory after a disconnected request. RLS remains the
// authority for all reads/writes; this is only local admission control.
const active = new Map<string, number>();

export async function POST(request: Request) {
  const jsonError = (error: string, status: number) =>
    Response.json({error}, {status, headers: {'Cache-Control': 'no-store'}});
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return jsonError('forbidden', 403);
  }
  const [user, member] = await Promise.all([getSessionUser(), getOwnMembership()]);
  if (!user || !member?.is_active) return jsonError('forbidden', 403);

  let input;
  let config;
  try {
    input = chatRequestSchema.parse(await readChatBody(request));
    config = await loadAssistantProviderConfig();
  } catch (error) {
    const code = error instanceof AssistantError ? error.code : 'invalid';
    return jsonError(code, code === 'notConfigured' ? 503 : 400);
  }
  const now = Date.now();
  for (const [id, expires] of active) if (expires < now) active.delete(id);
  if (active.has(user.id) || active.size >= 1000) return jsonError('busy', 429);
  const insforge = await createInsForgeServerClient();
  if (active.has(user.id)) return jsonError('busy', 429);
  const expires = now + 125000;
  active.set(user.id, expires);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110000)]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let connected = true;
      const emit = (event: AssistantEvent) => {
        if (!connected) return;
        try {controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));}
        catch {connected = false;}
      };
      try {
        await runAssistant({config, messages: input.messages,
          systemPrompt: platformPrompt(input.locale, input.pathname, user.id),
          tools: assistantTools, execute: createToolExecutor(insforge), emit, signal});
      } catch (error) {
        emit({type: 'error', error: signal.aborted ? 'timeout'
          : error instanceof AssistantError ? error.code : 'generic'});
        emit({type: 'done'});
      } finally {
        if (active.get(user.id) === expires) active.delete(user.id);
        if (connected) controller.close();
      }
    }
  });
  return new Response(stream, {headers: {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Accel-Buffering': 'no'
  }});
}
