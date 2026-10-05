import type {AssistantEvent, ChatMessage, ToolResult} from './protocol';

export type ProviderConfig = {endpoint: string; apiKey: string; model: string};
export type ToolDefinition = {
  type: 'function';
  function: {name: string; description: string; parameters: Record<string, unknown>};
};
type ToolCall = {id: string; type: 'function'; function: {name: string; arguments: string}};
type ProviderMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export class AssistantError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function readProviderConfig(env: Record<string, string | undefined>): ProviderConfig {
  const apiKey = env.ASSISTANT_API_KEY?.trim();
  const model = env.ASSISTANT_MODEL?.trim();
  const base = env.ASSISTANT_BASE_URL?.trim();
  if (!apiKey || !model || !base) throw new AssistantError('notConfigured');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new AssistantError('notConfigured');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AssistantError('notConfigured');
  }
  return {endpoint: `${base.replace(/\/+$/, '')}/chat/completions`, apiKey, model};
}

function parseReply(body: unknown): {content: string | null; tool_calls: ToolCall[]} {
  const message = (body as {choices?: {message?: {content?: unknown; tool_calls?: unknown}}[]} | null)
    ?.choices?.[0]?.message;
  if (!message || (message.content != null &&
      (typeof message.content !== 'string' || message.content.length > 12000))) {
    throw new AssistantError('providerError');
  }
  const calls = message.tool_calls ?? [];
  if (!Array.isArray(calls) || calls.length > 8) throw new AssistantError('providerError');
  const ids = new Set<string>();
  for (const call of calls) {
    if (!call || typeof call.id !== 'string' || !call.id || ids.has(call.id) ||
        call.type !== 'function' || typeof call.function?.name !== 'string' ||
        typeof call.function?.arguments !== 'string' || call.function.arguments.length > 12000) {
      throw new AssistantError('providerError');
    }
    ids.add(call.id);
  }
  return {content: (message.content as string | null) ?? null, tool_calls: calls as ToolCall[]};
}

// The loop belongs to the app: providers request named tools, never SQL or
// privileged credentials. Results are fed back before the next completion.
export async function runAssistant({
  config, messages, systemPrompt, tools, execute, emit, signal, fetcher = fetch
}: {
  config: ProviderConfig;
  messages: ChatMessage[];
  systemPrompt: string;
  tools: ToolDefinition[];
  execute: (name: string, input: unknown) => Promise<ToolResult>;
  emit: (event: AssistantEvent) => void;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<void> {
  const conversation: ProviderMessage[] = [{role: 'system', content: systemPrompt}, ...messages];
  const allowed = new Set(tools.map((tool) => tool.function.name));
  // Cache successful identical writes within this turn. A model repeating a
  // create after receiving its result must not create a second record.
  const performed = new Map<string, ToolResult>();
  let toolCount = 0;
  for (let step = 0; step < 6; step += 1) {
    signal.throwIfAborted();
    if (conversation.reduce((size, message) => size + (message.content?.length ?? 0), 0) > 120000) {
      throw new AssistantError('stepLimit');
    }
    const response = await fetcher(config.endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`},
      body: JSON.stringify({model: config.model, messages: conversation, tools, tool_choice: 'auto', max_tokens: 2048, stream: false}),
      signal,
      redirect: 'error'
    });
    // Do not expose the provider body: it can contain the request or secrets.
    if (!response.ok) throw new AssistantError(response.status === 429 ? 'rateLimited' : 'providerError');
    const reply = parseReply(await response.json());
    if (!reply.tool_calls.length) {
      if (!reply.content?.trim()) throw new AssistantError('providerError');
      emit({type: 'answer', content: reply.content});
      emit({type: 'done'});
      return;
    }
    // Check the entire batch before any side effect is executed.
    if (toolCount + reply.tool_calls.length > 12) throw new AssistantError('stepLimit');
    conversation.push({role: 'assistant', ...reply});
    for (const call of reply.tool_calls) {
      signal.throwIfAborted();
      toolCount += 1;
      let result: ToolResult;
      emit({type: 'working', id: call.id, tool: call.function.name});
      try {
        const input: unknown = JSON.parse(call.function.arguments);
        const key = `${call.function.name}:${canonicalJson(input)}`;
        result = performed.get(key) ?? (allowed.has(call.function.name)
          ? await execute(call.function.name, input)
          : {ok: false, error: 'unsupportedTool'});
        if (result.ok && result.changed) performed.set(key, result);
      } catch {
        result = {ok: false, error: 'toolFailed'};
      }
      emit({type: 'result', id: call.id, tool: call.function.name, result});
      conversation.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(result)});
    }
  }
  throw new AssistantError('stepLimit');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
