'use client';

import {
  isAllowedAttachmentType,
  isImageFile,
  resolveFileType,
  storedFileType
} from '@/lib/attachments';
import type {StoredImage} from '@/lib/actions/media';
import {insforge} from '@/lib/insforge/client';

export const PRODUCT_MEDIA_BUCKET = 'product-media';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_ACTION = 8;

// Documents get the same 25 MB ceiling as knowledge sources and lifecycle
// artifacts, and the same cap on how many go up at once.
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ACTION = 8;

function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const raw = dot > 0 ? name.slice(dot + 1) : '';
  const extension = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return extension ? `${crypto.randomUUID()}.${extension}` : crypto.randomUUID();
}

// Product logos and status-update images stay images-only: those surfaces
// render an <img>, so a PDF there would be a broken picture.
export function validateImageFiles(files: File[]): string | null {
  if (files.length > MAX_IMAGES_PER_ACTION) return 'tooManyImages';
  if (files.some((file) => !isImageFile(resolveFileType(file)))) {
    return 'imageType';
  }
  if (files.some((file) => file.size <= 0 || file.size > MAX_IMAGE_BYTES)) {
    return 'imageSize';
  }
  return null;
}

// Task attachments take documents too — markdown above all, which is why the
// check runs against the resolved type rather than File.type.
export function validateAttachmentFiles(files: File[]): string | null {
  if (files.length > MAX_ATTACHMENTS_PER_ACTION) return 'tooManyFiles';
  if (files.some((file) => !isAllowedAttachmentType(resolveFileType(file)))) {
    return 'fileType';
  }
  if (files.some((file) => file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES)) {
    return 'fileSize';
  }
  return null;
}

async function uploadAll(
  files: File[],
  folder: string,
  validate: (files: File[]) => string | null
): Promise<StoredImage[]> {
  const invalid = validate(files);
  if (invalid) throw new Error(invalid);

  const uploaded: StoredImage[] = [];
  try {
    for (const file of files) {
      const path = `${folder}/${safeFileName(file.name)}`;
      const {data, error} = await insforge.storage
        .from(PRODUCT_MEDIA_BUCKET)
        .upload(path, file);
      if (error || !data) throw new Error('uploadFailed');
      uploaded.push({
        url: data.url,
        key: data.key,
        fileName: file.name,
        mimeType: storedFileType(file, data.mimeType),
        sizeBytes: data.size || file.size
      });
    }
    return uploaded;
  } catch (error) {
    // Nothing referenced these rows yet, so an abandoned object is pure
    // litter. Best effort: a failed cleanup must not mask the real error.
    await Promise.allSettled(
      uploaded.map((image) =>
        insforge.storage.from(PRODUCT_MEDIA_BUCKET).remove(image.key)
      )
    );
    throw error;
  }
}

export function uploadImages(
  files: File[],
  folder: string
): Promise<StoredImage[]> {
  return uploadAll(files, folder, validateImageFiles);
}

export function uploadAttachments(
  files: File[],
  folder: string
): Promise<StoredImage[]> {
  return uploadAll(files, folder, validateAttachmentFiles);
}

export async function removeStoredImages(keys: string[]) {
  await Promise.allSettled(
    keys.map((key) =>
      insforge.storage.from(PRODUCT_MEDIA_BUCKET).remove(key)
    )
  );
}
