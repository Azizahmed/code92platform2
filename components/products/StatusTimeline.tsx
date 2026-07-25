'use client';

import Image from 'next/image';
import {Trash2} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useOptimistic, useState, useTransition} from 'react';

import HealthBadge, {type Health} from '@/components/HealthBadge';
import RelativeTime from '@/components/RelativeTime';
import StageChip, {type Stage} from '@/components/StageChip';
import {deleteStatusUpdateAction} from '@/lib/actions/status-updates';
import {removeStoredImages} from '@/lib/media-upload';

export type StatusUpdateAttachment = {
  id: string;
  status_update_id: string;
  storage_url: string;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type TimelineEntry = {
  id: string;
  health: Health;
  stage: Stage | null;
  summary: string;
  details: string | null;
  author_id: string | null;
  created_at: string;
  attachments: StatusUpdateAttachment[];
};

// Removing the newest update rolls the product's health/stage/next_review_at
// back to the previous one (an AFTER DELETE trigger does the rebuild), so the
// header above this list changes too. That part only lands once the server
// responds; the row itself disappears immediately.
export default function StatusTimeline({
  updates,
  authorNames,
  currentUserId,
  isAdmin,
  disabled = false
}: {
  updates: TimelineEntry[];
  authorNames: Record<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('products');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [optimisticUpdates, removeOptimistic] = useOptimistic(
    updates,
    (current: TimelineEntry[], removedId: string) =>
      current.filter((entry) => entry.id !== removedId)
  );

  function remove(entry: TimelineEntry) {
    if (!window.confirm(t('detail.deleteUpdateConfirm'))) return;
    setError(null);
    startTransition(async () => {
      // Drop the row first — the await below costs a full round trip.
      removeOptimistic(entry.id);
      const result = await deleteStatusUpdateAction(entry.id);
      // On failure React restores the row for us.
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The attachment rows cascade in the database; their storage objects do
      // not, so clear them here using the keys the action handed back.
      if (result.storageKeys.length > 0) {
        await removeStoredImages(result.storageKeys);
      }
    });
  }

  if (optimisticUpdates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center">
        <div className="text-sm font-medium">
          {t('detail.timelineEmptyTitle')}
        </div>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          {t('detail.timelineEmptyBody')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <ol className="space-y-3">
        {optimisticUpdates.map((u) => {
          const canDelete =
            !disabled && (isAdmin || u.author_id === currentUserId);

          return (
            <li
              key={u.id}
              className="group rounded-lg border border-hairline bg-panel p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <HealthBadge health={u.health} />
                {u.stage ? <StageChip stage={u.stage} /> : null}
                <span className="ms-auto flex items-center gap-1">
                  <RelativeTime date={u.created_at} />
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => remove(u)}
                      aria-label={t('detail.deleteUpdate')}
                      title={t('detail.deleteUpdate')}
                      className="rounded p-1.5 text-faint opacity-0 transition-all hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  ) : null}
                </span>
              </div>

              <p className="mt-2 text-sm font-medium">{u.summary}</p>

              {u.details ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                  {u.details}
                </p>
              ) : null}

              {u.attachments.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {u.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.storage_url}
                      target="_blank"
                      rel="noreferrer"
                      className="relative aspect-[4/3] overflow-hidden rounded-md border border-hairline bg-bg transition-colors hover:border-accent/40"
                      title={attachment.file_name}
                    >
                      <Image
                        src={attachment.storage_url}
                        alt={attachment.file_name}
                        fill
                        unoptimized
                        sizes="(max-width: 640px) 50vw, 220px"
                        className="object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : null}

              <div className="mt-2 text-[11px] text-faint">
                {t('detail.byAuthor', {
                  name: (u.author_id && authorNames[u.author_id]) || '—'
                })}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
