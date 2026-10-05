export type ChatMessage = {role: 'user' | 'assistant'; content: string};

export type ToolResult = {
  ok: boolean;
  error?: string;
  data?: unknown;
  href?: string;
  changed?: boolean;
};

export type AssistantEvent =
  | {type: 'working'; tool: string; id: string}
  | {type: 'result'; tool: string; id: string; result: ToolResult}
  | {type: 'answer'; content: string}
  | {type: 'error'; error: string}
  | {type: 'done'};

// Responses are newline-delimited JSON. A chunk can split either a line or a
// UTF-8 character; the client keeps the trailing line until the next read.
export function parseEventLine(line: string): AssistantEvent {
  return JSON.parse(line) as AssistantEvent;
}
