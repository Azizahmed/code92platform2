'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {isAllowedAttachmentType} from '@/lib/attachments';
import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export type StoredImage = {
  url: string;
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type MediaActionResult =
  | {ok: true; previousKey?: string | null}
  | {ok: false; error: string};

const storedImageSchema = z.object({
  url: z.string().url().max(2000),
  key: z.string().trim().min(1).max(1000),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024)
});

const imageListSchema = z.array(storedImageSchema).min(1).max(8);

// Task attachments are documents as well as screenshots. Same shape, wider
// type rule and the 25 MB document ceiling. The client is not trusted for
// either: it reports the mime type it stored, and this re-checks it against
// the same allowlist the database CHECK enforces.
const storedFileSchema = storedImageSchema.extend({
  mimeType: z
    .string()
    .max(255)
    .refine(isAllowedAttachmentType, {message: 'unsupported file type'}),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024)
});

const fileListSchema = z.array(storedFileSchema).min(1).max(8);

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

export async function setProductLogoAction(
  productId: string,
  image: StoredImage | null
): Promise<MediaActionResult> {
  if (
    !z.string().uuid().safeParse(productId).success ||
    (image !== null && !storedImageSchema.safeParse(image).success)
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: current} = await insforge.database
    .from('products')
    .select('logo_key')
    .eq('id', productId)
    .maybeSingle();

  const {data, error} = await insforge.database
    .from('products')
    .update({
      logo_url: image?.url ?? null,
      logo_key: image?.key ?? null
    })
    .eq('id', productId)
    .select('id');

  if (error) return {ok: false, error: 'generic'};
  if (!data?.length) return {ok: false, error: 'forbidden'};

  revalidatePath('/[locale]/products', 'page');
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath(`/[locale]/products/${productId}/edit`, 'page');
  revalidatePath('/[locale]', 'page');

  return {
    ok: true,
    previousKey: (current?.logo_key as string | null | undefined) ?? null
  };
}

export async function addTaskAttachmentsAction(
  taskId: string,
  images: StoredImage[]
): Promise<MediaActionResult> {
  const parsedImages = fileListSchema.safeParse(images);
  if (
    !z.string().uuid().safeParse(taskId).success ||
    !parsedImages.success
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: task} = await insforge.database
    .from('product_tasks')
    .select('product_id')
    .eq('id', taskId)
    .maybeSingle();
  if (!task) return {ok: false, error: 'notFound'};

  const {error} = await insforge.database.from('task_attachments').insert(
    parsedImages.data.map((image) => ({
      task_id: taskId,
      uploader_id: caller.user.id,
      storage_url: image.url,
      storage_key: image.key,
      file_name: image.fileName,
      mime_type: image.mimeType,
      size_bytes: image.sizeBytes
    }))
  );

  if (error) return {ok: false, error: 'generic'};

  revalidatePath(
    `/[locale]/products/${task.product_id as string}`,
    'page'
  );
  return {ok: true};
}

export async function addStatusUpdateAttachmentsAction(
  statusUpdateId: string,
  images: StoredImage[]
): Promise<MediaActionResult> {
  const parsedImages = imageListSchema.safeParse(images);
  if (
    !z.string().uuid().safeParse(statusUpdateId).success ||
    !parsedImages.success
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data: update} = await insforge.database
    .from('status_updates')
    .select('product_id')
    .eq('id', statusUpdateId)
    .maybeSingle();
  if (!update) return {ok: false, error: 'notFound'};

  const {error} = await insforge.database
    .from('status_update_attachments')
    .insert(
      parsedImages.data.map((image) => ({
        status_update_id: statusUpdateId,
        uploader_id: caller.user.id,
        storage_url: image.url,
        storage_key: image.key,
        file_name: image.fileName,
        mime_type: image.mimeType,
        size_bytes: image.sizeBytes
      }))
    );

  if (error) return {ok: false, error: 'generic'};

  revalidatePath(
    `/[locale]/products/${update.product_id as string}`,
    'page'
  );
  return {ok: true};
}
