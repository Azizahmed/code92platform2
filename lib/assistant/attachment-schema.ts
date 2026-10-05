import {z} from 'zod';
import {attachmentBytes, isAssistantTextType, MAX_ASSISTANT_FILE_BYTES, MAX_ASSISTANT_TEXT} from './attachments';

const metadata = {
  name: z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/),
  sizeBytes: z.number().int().positive().max(MAX_ASSISTANT_FILE_BYTES)
};
export const assistantAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({...metadata, kind: z.literal('image'), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    dataUrl: z.string().max(Math.ceil(MAX_ASSISTANT_FILE_BYTES / 3) * 4 + 50)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
  }).strict().refine((file) => file.dataUrl.startsWith(`data:${file.mimeType};base64,`) &&
    file.dataUrl.slice(file.dataUrl.indexOf(',') + 1).length % 4 === 0 &&
    attachmentBytes(file) > 0 && attachmentBytes(file) <= MAX_ASSISTANT_FILE_BYTES),
  z.object({...metadata, kind: z.literal('text'), mimeType: z.string().max(100)
    .refine((type) => type === 'application/pdf' || isAssistantTextType(type)),
    text: z.string().trim().min(1).max(MAX_ASSISTANT_TEXT), truncated: z.boolean()
  }).strict()
]);
