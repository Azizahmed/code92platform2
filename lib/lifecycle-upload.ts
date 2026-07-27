'use client';

import {insforge} from '@/lib/insforge/client';
import {isAllowedKnowledgeFileType} from '@/lib/knowledge';
import {
  LIFECYCLE_FILE_BUCKET,
  MAX_LIFECYCLE_FILE_BYTES,
  type LifecyclePhase
} from '@/lib/lifecycle';

export type StoredArtifactFile = {
  url: string;
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function safeFileName(name: string): string {
  const extension = name.includes('.') ? name.split('.').pop() : '';
  const suffix = (extension || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return suffix ? `${crypto.randomUUID()}.${suffix}` : crypto.randomUUID();
}

// Same allowlist the knowledge base uses — markdown and plain text via the
// text/ prefix, plus PDF and the Office formats.
export function validateArtifactFile(file: File): string | null {
  if (file.size <= 0 || file.size > MAX_LIFECYCLE_FILE_BYTES) return 'fileSize';
  if (!isAllowedKnowledgeFileType(file.type)) return 'fileType';
  return null;
}

export async function uploadArtifactFile(
  file: File,
  phase: LifecyclePhase
): Promise<StoredArtifactFile> {
  const invalid = validateArtifactFile(file);
  if (invalid) throw new Error(invalid);

  const path = `${phase}/${safeFileName(file.name)}`;
  const {data, error} = await insforge.storage
    .from(LIFECYCLE_FILE_BUCKET)
    .upload(path, file);
  if (error || !data) throw new Error('uploadFailed');

  return {
    url: data.url,
    key: data.key,
    fileName: file.name,
    mimeType: data.mimeType || file.type || 'application/octet-stream',
    sizeBytes: data.size || file.size
  };
}

// Best-effort cleanup of an object the database never ended up referencing.
export async function removeArtifactFile(key: string) {
  await Promise.allSettled([
    insforge.storage.from(LIFECYCLE_FILE_BUCKET).remove(key)
  ]);
}
