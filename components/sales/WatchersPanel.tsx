'use client';

import {Eye, EyeOff} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useState} from 'react';

import {setRecordWatchAction} from '@/lib/actions/notifications';
import type {MemberOption} from '@/lib/sales/types';
import {useServerAction} from '@/lib/use-server-action';

// Who hears about this record. The owner always does and cannot opt out;
// anyone else watches or unwatches themselves — the same self-service rule as
// task watchers, enforced by RLS.
export default function WatchersPanel({
  recordType,
  recordId,
  ownerId,
  watcherIds,
  members,
  currentUserId
}: {
  recordType: 'deal' | 'account';
  recordId: string;
  ownerId: string;
  watcherIds: string[];
  members: MemberOption[];
  currentUserId: string;
}) {
  const t = useTranslations('sales');
  const tNotifications = useTranslations('notifications');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const nameOf = (id: string) => members.find((member) => member.userId === id)?.displayName ?? '—';
  const watching = watcherIds.includes(currentUserId);
  const isOwner = ownerId === currentUserId;

  function toggle() {
    setError(null);
    void run(async () => {
      const result = await setRecordWatchAction(recordType, recordId, !watching);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted">
          {t('watchers.owner')}: <span className="text-ink">{nameOf(ownerId)}</span>
        </span>
        {isOwner ? null : (
          <button
            type="button"
            disabled={pending}
            onClick={toggle}
            aria-pressed={watching}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
              watching ? 'border-accent/40 bg-accent/10 text-accent' : 'border-hairline text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            {watching ? <Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> : <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />}
            {watching ? tNotifications('watchRecord.stop') : tNotifications('watchRecord.start')}
          </button>
        )}
      </div>
      {isOwner ? <p className="text-[11px] text-faint">{tNotifications('watchRecord.ownerNote')}</p> : null}

      {watcherIds.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {watcherIds.map((id) => (
            <li key={id} className="rounded-full border border-hairline bg-raised px-2.5 py-0.5 text-xs text-muted">
              {nameOf(id)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-faint">{t('watchers.none')}</p>
      )}
      {error ? <p className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
