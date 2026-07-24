'use client';

import {insforge} from '@/lib/insforge/client';
import {
  KNOWLEDGE_FILE_BUCKET,
  MAX_KNOWLEDGE_FILE_BYTES,
  isAllowedKnowledgeFileType
} from '@/lib/knowledge';

export type StoredFile = {
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

export function validateKnowledgeFile(file: File): string | null {
  if (file.size <= 0 || file.size > MAX_KNOWLEDGE_FILE_BYTES) return 'fileSize';
  if (!isAllowedKnowledgeFileType(file.type)) return 'fileType';
  return null;
}

export async function uploadKnowledgeFile(file: File): Promise<StoredFile> {
  const invalid = validateKnowledgeFile(file);
  if (invalid) throw new Error(invalid);

  const path = `sources/${safeFileName(file.name)}`;
  const {data, error} = await insforge.storage
    .from(KNOWLEDGE_FILE_BUCKET)
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
export async function removeKnowledgeFile(key: string) {
  await Promise.allSettled([
    insforge.storage.from(KNOWLEDGE_FILE_BUCKET).remove(key)
  ]);
}
