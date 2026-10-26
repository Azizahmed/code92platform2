'use client';

import {Archive, ArchiveRestore} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useState} from 'react';

import {setAccountArchivedAction} from '@/lib/actions/sales';
import {useServerAction} from '@/lib/use-server-action';

export default function ArchiveAccountButton({accountId, archived}: {accountId: string; archived: boolean}) {
  const t = useTranslations('sales');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  function toggle() {
    if (!archived && !window.confirm(t('archive.confirm'))) return;
    setError(null);
    void run(async () => {
      const result = await setAccountArchivedAction(accountId, !archived);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
      >
        {archived ? <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />}
        {archived ? t('archive.unarchive') : t('archive.archive')}
      </button>
      {error ? <span className="text-[11px] text-danger">{t(`errors.${error}`)}</span> : null}
    </span>
  );
}
