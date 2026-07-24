'use client';

import type {StoredImage} from '@/lib/actions/media';
import {insforge} from '@/lib/insforge/client';

export const PRODUCT_MEDIA_BUCKET = 'product-media';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_ACTION = 8;

function safeFileName(name: string): string {
  const extension = name.includes('.') ? name.split('.').pop() : 'jpg';
  return `${crypto.randomUUID()}.${(extension || 'jpg')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')}`;
}

export function validateImageFiles(files: File[]): string | null {
  if (files.length > MAX_IMAGES_PER_ACTION) return 'tooManyImages';
  if (files.some((file) => !file.type.startsWith('image/'))) {
    return 'imageType';
  }
  if (files.some((file) => file.size <= 0 || file.size > MAX_IMAGE_BYTES)) {
    return 'imageSize';
  }
  return null;
}

export async function uploadImages(
  files: File[],
  folder: string
): Promise<StoredImage[]> {
  const invalid = validateImageFiles(files);
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
        mimeType: data.mimeType || file.type,
        sizeBytes: data.size || file.size
      });
    }
    return uploaded;
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((image) =>
        insforge.storage.from(PRODUCT_MEDIA_BUCKET).remove(image.key)
      )
    );
    throw error;
  }
}

export async function removeStoredImages(keys: string[]) {
  await Promise.allSettled(
    keys.map((key) =>
      insforge.storage.from(PRODUCT_MEDIA_BUCKET).remove(key)
    )
  );
}
