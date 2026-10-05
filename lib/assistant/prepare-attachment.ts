import {getDocumentProxy} from 'unpdf';
import {resolveFileType} from '@/lib/attachments';
import {isAssistantImageType, MAX_ASSISTANT_TEXT, validateAssistantFile,
  type AssistantAttachment} from './attachments';
import {AssistantError} from './runtime';

function hasImageSignature(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/png') return bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.length >= 16 && Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP';
}

export async function prepareAssistantAttachment(file: File, signal: AbortSignal): Promise<AssistantAttachment> {
  const invalid = validateAssistantFile(file);
  if (invalid) throw new AssistantError(invalid);
  signal.throwIfAborted();
  const mimeType = resolveFileType(file);
  const name = file.name.replace(/[\x00-\x1f\x7f]/g, '').split(/[\\/]/).at(-1)?.slice(0, 200) || 'attachment';
  const metadata = {name, mimeType, sizeBytes: file.size};
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isAssistantImageType(mimeType)) {
    if (!hasImageSignature(bytes, mimeType)) throw new AssistantError('fileUnreadable');
    return {...metadata, kind: 'image', dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`};
  }
  let text = '';
  let truncated = false;
  if (mimeType === 'application/pdf') {
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new AssistantError('fileUnreadable');
    const pdf = await getDocumentProxy(bytes, {useSystemFonts: true, disableFontFace: true, verbosity: 0});
    const abort = () => {void pdf.loadingTask.destroy().catch(() => {});};
    signal.addEventListener('abort', abort, {once: true});
    try {
      const pages = Math.min(pdf.numPages, 50);
      truncated = pdf.numPages > pages;
      for (let index = 1; index <= pages; index++) {
        signal.throwIfAborted();
        const page = await pdf.getPage(index);
        try {
          const content = await page.getTextContent();
          for (const item of content.items) {
            if (!('str' in item)) continue;
            text += item.str + (item.hasEOL ? '\n' : ' ');
            if (text.length > MAX_ASSISTANT_TEXT) break;
          }
        } finally {page.cleanup();}
        text += '\n';
        if (text.length > MAX_ASSISTANT_TEXT) {truncated = true; break;}
      }
    } finally {
      signal.removeEventListener('abort', abort);
      await pdf.loadingTask.destroy();
    }
  } else {
    try {text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);}
    catch {throw new AssistantError('fileUnreadable');}
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new AssistantError('fileUnreadable');
    truncated = text.length > MAX_ASSISTANT_TEXT;
  }
  signal.throwIfAborted();
  text = text.slice(0, MAX_ASSISTANT_TEXT).trim();
  if (!text) throw new AssistantError('fileNoText');
  return {...metadata, kind: 'text', text, truncated};
}
