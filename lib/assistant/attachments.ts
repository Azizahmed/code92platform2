import {resolveFileType} from '@/lib/attachments';
import type {ChatMessage} from './protocol';

export const MAX_ASSISTANT_FILES = 3;
export const MAX_ASSISTANT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ASSISTANT_TEXT = 12000;
export const MAX_ASSISTANT_BODY_BYTES = 3400000;
export const ASSISTANT_FILE_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.log,text/plain,text/markdown,text/csv,application/json,application/pdf,image/png,image/jpeg,image/webp';
export type AssistantAttachment = {
  name: string;
  mimeType: string;
  sizeBytes: number;
} & ({kind: 'image'; dataUrl: string} | {kind: 'text'; text: string; truncated: boolean});

export function isAssistantImageType(type: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(type);
}
export function isAssistantTextType(type: string): boolean {
  return type.startsWith('text/') || ['application/json', 'application/yaml', 'application/x-yaml'].includes(type);
}
export function validateAssistantFile(file: {name: string; type: string; size: number}): string | null {
  if (file.size <= 0 || file.size > MAX_ASSISTANT_FILE_BYTES) return 'fileSize';
  const type = resolveFileType(file);
  return isAssistantImageType(type) || isAssistantTextType(type) || type === 'application/pdf' ? null : 'fileType';
}

export function attachmentBytes(file: AssistantAttachment): number {
  if (file.kind === 'text') return new TextEncoder().encode(file.text).byteLength;
  const encoded = file.dataUrl.slice(file.dataUrl.indexOf(',') + 1);
  return encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
}

export function chatTextSize(messages: ChatMessage[]): number {
  return messages.reduce((size, message) => size + message.content.length +
    (message.attachments ?? []).reduce((n, file) => n + (file.kind === 'text' ? file.text.length : 0), 0), 0);
}

export function chatAttachmentsFit(messages: ChatMessage[]): boolean {
  const files = messages.flatMap((message) => message.attachments ?? []);
  return files.length <= 6 && files.reduce((size, file) => size + attachmentBytes(file), 0) <= MAX_ASSISTANT_FILE_BYTES;
}

// Keep recent references for follow-up questions, while bounding each request.
export function trimChatHistory(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-20);
  while (recent.length > 1 && (chatTextSize(recent) > 60000 || !chatAttachmentsFit(recent))) recent.shift();
  return recent;
}
