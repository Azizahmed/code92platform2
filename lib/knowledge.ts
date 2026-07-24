// Shared knowledge-base vocabulary. Kept out of the 'use server' action
// module so client components can import the constants themselves, not just
// the types. Mirrors the CHECK constraints in the knowledge base migration —
// change both together.

export const KNOWLEDGE_KINDS = ['article', 'note', 'source'] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

// Articles and notes follow an editorial lifecycle; sources move through a
// review pipeline instead.
export const WRITING_STATUSES = ['draft', 'published'] as const;
export const SOURCE_STATUSES = ['to_review', 'in_use', 'processed'] as const;
export const KNOWLEDGE_STATUSES = [
  ...WRITING_STATUSES,
  ...SOURCE_STATUSES
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export function statusesForKind(
  kind: KnowledgeKind
): readonly KnowledgeStatus[] {
  return kind === 'source' ? SOURCE_STATUSES : WRITING_STATUSES;
}

export function defaultStatusForKind(kind: KnowledgeKind): KnowledgeStatus {
  return kind === 'source' ? 'to_review' : 'draft';
}

export function isStatusForKind(
  kind: KnowledgeKind,
  status: KnowledgeStatus
): boolean {
  return statusesForKind(kind).includes(status);
}

// Sources may carry an uploaded document. The bucket is private: readers get
// short-lived signed URLs, never a stored public link.
export const KNOWLEDGE_FILE_BUCKET = 'knowledge-files';
export const MAX_KNOWLEDGE_FILE_BYTES = 25 * 1024 * 1024;
export const SIGNED_FILE_URL_TTL_SECONDS = 300;

const ALLOWED_FILE_TYPE_PREFIXES = ['image/', 'text/'];
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);

export function isAllowedKnowledgeFileType(mimeType: string): boolean {
  const type = mimeType.toLowerCase();
  return (
    ALLOWED_FILE_TYPES.has(type) ||
    ALLOWED_FILE_TYPE_PREFIXES.some((prefix) => type.startsWith(prefix))
  );
}
