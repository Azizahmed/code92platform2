// File-type vocabulary shared by every upload surface: knowledge sources,
// lifecycle artifacts, and task attachments.
//
// The reason this file exists is `.md`. A browser fills File.type from the OS
// mime registry, and neither Windows nor most Linux desktops register an entry
// for markdown — so picking a .md file hands JavaScript `type: ''`, which every
// allowlist here used to reject as "not a permitted type". The file was fine;
// the question was wrong. resolveFileType() asks the extension when the browser
// has nothing to say.
//
// Mirrors public.is_allowed_attachment_type() in
// migrations/20260803090000_allow-document-attachments.sql — change both
// together, or an upload that passes here will be rejected by the CHECK.

export const MARKDOWN_MIME = 'text/markdown';

// Only consulted when the browser gives us nothing usable. A browser that does
// know the type is more trustworthy than a file name.
const EXTENSION_TYPES: Record<string, string> = {
  md: MARKDOWN_MIME,
  markdown: MARKDOWN_MIME,
  mdx: MARKDOWN_MIME,
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  rtf: 'application/rtf',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml'
};

const ALLOWED_PREFIXES = ['image/', 'text/'];
const ALLOWED_TYPES = new Set([
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

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

// The type an upload should be stored under. `application/octet-stream` counts
// as "the browser does not know" — that is what Chrome reports for a good many
// unregistered extensions, not just an empty string.
export function resolveFileType(file: {name: string; type: string}): string {
  const declared = file.type.trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream') return declared;
  return EXTENSION_TYPES[fileExtension(file.name)] ?? declared;
}

// The type to persist after an upload. Storage sniffs the object and usually
// knows better than the browser, but it falls back to application/octet-stream
// for the same unregistered extensions — so the extension gets the last word
// either way, and the row never stores a type the CHECK would refuse.
export function storedFileType(
  file: {name: string; type: string},
  storageMimeType?: string | null
): string {
  return resolveFileType({name: file.name, type: storageMimeType || file.type});
}

export function isAllowedAttachmentType(mimeType: string): boolean {
  const type = mimeType.trim().toLowerCase();
  if (!type) return false;
  return (
    ALLOWED_TYPES.has(type) ||
    ALLOWED_PREFIXES.some((prefix) => type.startsWith(prefix))
  );
}

export function isMarkdownFile(mimeType: string, fileName: string): boolean {
  const type = mimeType.toLowerCase();
  if (type === MARKDOWN_MIME || type === 'text/x-markdown') return true;
  return ['md', 'markdown', 'mdx'].includes(fileExtension(fileName));
}

export function isImageFile(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

// The `accept` attribute for a document-capable file input. Extensions are
// listed alongside the MIME types for exactly the reason above: on a machine
// with no registry entry for .md, a MIME-only accept list greys the file out in
// the picker, so the user cannot even try.
export const DOCUMENT_ACCEPT = [
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.json',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.rtf',
  'text/*',
  'image/*',
  'application/pdf'
].join(',');

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
