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

// Where an item came from. `lifecycle` items are mirrored from a phase
// artifact by the mirror_artifact_to_knowledge() trigger — nobody writes one by
// hand, and no client role can insert or forge the origin columns.
export const KNOWLEDGE_ORIGINS = ['manual', 'lifecycle'] as const;
export type KnowledgeOrigin = (typeof KNOWLEDGE_ORIGINS)[number];

// A mirrored item points at the artifact's object in the lifecycle bucket
// rather than a copy of it, so file_key alone is not enough to read a file —
// the bucket has to come with it.
export const KNOWLEDGE_FILE_BUCKETS = [
  'knowledge-files',
  'lifecycle-artifacts'
] as const;
export type KnowledgeFileBucket = (typeof KNOWLEDGE_FILE_BUCKETS)[number];

// Sources may carry an uploaded document. The bucket is private: readers get
// short-lived signed URLs, never a stored public link.
export const KNOWLEDGE_FILE_BUCKET = 'knowledge-files';
export const MAX_KNOWLEDGE_FILE_BYTES = 25 * 1024 * 1024;
export const SIGNED_FILE_URL_TTL_SECONDS = 300;

// The allowlist moved to lib/attachments.ts when task attachments started
// taking documents too — three surfaces, one definition, and one place that
// mirrors the SQL CHECK. Re-exported under the old name so existing callers
// read unchanged.
export {isAllowedAttachmentType as isAllowedKnowledgeFileType} from '@/lib/attachments';
