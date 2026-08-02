'use client';

import Image from 'next/image';
import {useEffect, useState} from 'react';
import {ExternalLink, FileText, X} from 'lucide-react';
import {useTranslations} from 'next-intl';

import Markdown from '@/components/knowledge/Markdown';
import type {TaskAttachment} from '@/lib/actions/tasks';
import {formatFileSize, isImageFile, isMarkdownFile} from '@/lib/attachments';

// Task attachments render two ways because they are two different things: a
// screenshot is worth showing, a document is worth naming. Markdown gets a
// third treatment — it is read in place, since the whole point of attaching the
// spec to the task is not having to leave the task to read it.

function MarkdownPreview({
  attachment,
  onClose
}: {
  attachment: TaskAttachment;
  onClose: () => void;
}) {
  const t = useTranslations('tasks');
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(attachment.storage_url)
      .then((response) => {
        if (!response.ok) throw new Error('fetchFailed');
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        // Reading the object from the browser can fail for reasons that have
        // nothing to do with the file — an offline tab, a CORS rule on the
        // bucket. The link out always works, so offer that instead of a dead
        // spinner.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_url]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.file_name}
      className="fixed inset-0 z-50 flex items-end justify-center p-3 md:items-center"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('attachments.closePreview')}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      <div className="relative flex max-h-[85vh] w-full flex-col rounded-2xl border border-hairline bg-panel shadow-2xl md:max-w-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
            <span dir="ltr" className="truncate text-sm font-medium">
              {attachment.file_name}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={attachment.storage_url}
              target="_blank"
              rel="noreferrer"
              aria-label={t('attachments.openFile')}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('attachments.closePreview')}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {failed ? (
            <p className="text-sm text-muted">{t('attachments.previewFailed')}</p>
          ) : content === null ? (
            <p className="text-sm text-faint">{t('attachments.loading')}</p>
          ) : (
            <Markdown content={content} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function TaskAttachments({
  attachments,
  compact = false
}: {
  attachments: TaskAttachment[];
  compact?: boolean;
}) {
  const t = useTranslations('tasks');
  const [previewing, setPreviewing] = useState<TaskAttachment | null>(null);

  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => isImageFile(a.mime_type));
  const documents = attachments.filter((a) => !isImageFile(a.mime_type));

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment) => (
            <a
              key={attachment.id}
              href={attachment.storage_url}
              target="_blank"
              rel="noreferrer"
              className="relative h-16 w-20 overflow-hidden rounded-md border border-hairline bg-bg transition-colors hover:border-accent/40"
              title={attachment.file_name}
            >
              <Image
                src={attachment.storage_url}
                alt={t('media.attachmentAlt', {name: attachment.file_name})}
                fill
                unoptimized
                sizes="80px"
                className="object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}

      {documents.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {documents.map((attachment) => {
            const markdown = isMarkdownFile(
              attachment.mime_type,
              attachment.file_name
            );
            const label = (
              <>
                <FileText
                  className="h-3.5 w-3.5 shrink-0 text-accent"
                  strokeWidth={1.75}
                />
                <span dir="ltr" className="max-w-[14rem] truncate">
                  {attachment.file_name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {formatFileSize(attachment.size_bytes)}
                </span>
              </>
            );
            const className =
              'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-bg px-2 py-1.5 text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-ink';

            return (
              <li key={attachment.id}>
                {markdown ? (
                  <button
                    type="button"
                    onClick={() => setPreviewing(attachment)}
                    title={t('attachments.preview')}
                    className={className}
                  >
                    {label}
                  </button>
                ) : (
                  <a
                    href={attachment.storage_url}
                    target="_blank"
                    rel="noreferrer"
                    title={t('attachments.openFile')}
                    className={className}
                  >
                    {label}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {previewing ? (
        <MarkdownPreview
          attachment={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </div>
  );
}
