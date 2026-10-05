import 'server-only';

import {randomUUID} from 'node:crypto';

import {fileExtension, isAllowedAttachmentType, isImageFile, resolveFileType} from '@/lib/attachments';
import type {createInsForgeServerClient} from '@/lib/insforge/server';
import {seal, unseal} from './tokens';

// Files an MCP client hands to the platform. The browser uploads straight to
// storage and then records the object with an action; a client cannot, so the
// server stores the bytes under the member's own session and returns an opaque
// fileId — a signed record of exactly what was stored, for whom and where. The
// attach tools accept only fileIds, never raw keys, so a client cannot point a
// row at an object it did not upload.

type ServerClient = Awaited<ReturnType<typeof createInsForgeServerClient>>;

export const FILE_PURPOSES = {
  // product-media is the bucket the task, status-update and logo surfaces use.
  task: {bucket: 'product-media', folder: 'mcp/tasks', images: false, maxBytes: 25 * 1024 * 1024},
  status_update: {bucket: 'product-media', folder: 'mcp/updates', images: true, maxBytes: 10 * 1024 * 1024},
  logo: {bucket: 'product-media', folder: 'products/logos', images: true, maxBytes: 10 * 1024 * 1024},
  knowledge: {bucket: 'knowledge-files', folder: 'sources', images: false, maxBytes: 25 * 1024 * 1024},
  message: {bucket: 'knowledge-files', folder: 'channels', images: false, maxBytes: 25 * 1024 * 1024},
  lifecycle: {bucket: 'lifecycle-artifacts', folder: 'mcp', images: false, maxBytes: 25 * 1024 * 1024}
} as const;

export type FilePurpose = keyof typeof FILE_PURPOSES;
export const FILE_PURPOSE_NAMES = Object.keys(FILE_PURPOSES) as [FilePurpose, ...FilePurpose[]];

// Serverless request bodies are capped (4.5 MB on Vercel), so this is the
// practical ceiling for bytes that arrive through the app, whatever the bucket
// would accept.
export const MAX_MCP_UPLOAD_BYTES = 4 * 1024 * 1024;
// upload_file carries the bytes base64-encoded inside a JSON-RPC request, which
// must fit under the same cap with its envelope.
export const MAX_MCP_INLINE_UPLOAD_BYTES = 3 * 1024 * 1024;

export type StoredFile = {url: string; key: string; fileName: string; mimeType: string; sizeBytes: number};
type FileHandle = StoredFile & {userId: string; purpose: FilePurpose};
type UploadTicket = {userId: string; tokenId: string; purpose: FilePurpose; fileName: string; mimeType: string};

const FILE_HANDLE_SECONDS = 24 * 60 * 60;
const UPLOAD_TICKET_SECONDS = 15 * 60;

export class McpFileError extends Error {
  constructor(public code: 'fileType' | 'fileSize' | 'fileName' | 'uploadFailed' | 'invalidFile') {
    super(code);
  }
}

// The type a file is stored and recorded under: what the client declared,
// else the extension, then held to the same allowlist the database CHECK uses.
export function checkUpload(purpose: FilePurpose, fileName: string, declaredType: string | undefined, size: number) {
  const name = fileName.trim();
  if (!name || name.length > 255 || /[\\/\u0000-\u001f]/.test(name)) throw new McpFileError('fileName');
  const mimeType = resolveFileType({name, type: declaredType ?? ''});
  const rule = FILE_PURPOSES[purpose];
  if (!isAllowedAttachmentType(mimeType) || (rule.images && !isImageFile(mimeType))) {
    throw new McpFileError('fileType');
  }
  if (size <= 0 || size > Math.min(rule.maxBytes, MAX_MCP_UPLOAD_BYTES)) throw new McpFileError('fileSize');
  return {fileName: name, mimeType};
}

export async function storeFile(insforge: ServerClient, userId: string, purpose: FilePurpose,
  file: {fileName: string; mimeType?: string; bytes: Uint8Array}) {
  const {fileName, mimeType} = checkUpload(purpose, file.fileName, file.mimeType, file.bytes.byteLength);
  const rule = FILE_PURPOSES[purpose];
  const extension = fileExtension(fileName).replace(/[^a-z0-9]/g, '');
  const path = `${rule.folder}/${randomUUID()}${extension ? `.${extension}` : ''}`;
  const {data, error} = await insforge.storage.from(rule.bucket)
    .upload(path, new Blob([new Uint8Array(file.bytes)], {type: mimeType}));
  if (error || !data) throw new McpFileError('uploadFailed');
  const stored: StoredFile = {url: data.url, key: data.key, fileName, mimeType,
    sizeBytes: data.size || file.bytes.byteLength};
  return {
    fileId: seal('file', {...stored, userId, purpose} satisfies FileHandle, FILE_HANDLE_SECONDS),
    fileName, mimeType, sizeBytes: stored.sizeBytes, purpose
  };
}

// A fileId is usable only by the member who uploaded it, only for the purpose
// it was uploaded for, and only for a day.
export function openFile(fileId: unknown, userId: string, purpose: FilePurpose): StoredFile {
  const handle = unseal<FileHandle>('file', fileId);
  if (!handle || handle.userId !== userId || handle.purpose !== purpose) throw new McpFileError('invalidFile');
  return {url: handle.url, key: handle.key, fileName: handle.fileName, mimeType: handle.mimeType,
    sizeBytes: handle.sizeBytes};
}

export function createUploadTicket(ticket: UploadTicket) {
  checkUpload(ticket.purpose, ticket.fileName, ticket.mimeType, 1);
  return seal('upload', ticket, UPLOAD_TICKET_SECONDS);
}

export function openUploadTicket(value: unknown): UploadTicket | null {
  return unseal<UploadTicket>('upload', value);
}
