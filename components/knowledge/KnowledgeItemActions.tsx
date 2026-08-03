'use client';

import {Archive, ArchiveRestore, Trash2} from 'lucide-react';
import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import {useRouter} from '@/i18n/navigation';
import {
  deleteKnowledgeItemAction,
  setKnowledgeArchivedAction
} from '@/lib/actions/knowledge';
import {removeKnowledgeFile} from '@/lib/knowledge-upload';

// Only rendered for the author or an admin; RLS re-checks both operations.
export default function KnowledgeItemActions({
  itemId,
  archived,
  // A lifecycle-derived item is removed by removing the artifact it mirrors.
  // The RLS policy refuses the delete outright; hiding the button means the
  // refusal is never how somebody finds that out.
  deletable = true
}: {
  itemId: string;
  archived: boolean;
  deletable?: boolean;
}) {
  const t = useTranslations('knowledge');
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleArchive() {
    const confirmed = window.confirm(
      archived ? t('danger.unarchiveConfirm') : t('danger.archiveConfirm')
    );
    if (!confirmed) return;
    setErrorKey(null);

    startTransition(async () => {
      const result = await setKnowledgeArchivedAction(itemId, !archived);
      if (!result.ok) setErrorKey(result.error);
      // No router.refresh(): revalidatePath in the action already returns the
      // re-rendered page with the response.
    });
  }

  function handleDelete() {
    if (!window.confirm(t('danger.deleteConfirm'))) return;
    setErrorKey(null);

    startTransition(async () => {
      const result = await deleteKnowledgeItemAction(itemId);
      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      // The row is gone; clean up its storage object too.
      if (result.fileKey) await removeKnowledgeFile(result.fileKey);
      // revalidatePath already invalidated the client router cache, so this
      // push lands on a freshly fetched list.
      router.push('/knowledge');
    });
  }

  const ArchiveIcon = archived ? ArchiveRestore : Archive;

  return (
    <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-5">
      <h2 className="text-sm font-medium text-danger">{t('danger.title')}</h2>
      <p className="text-xs leading-relaxed text-muted">
        {deletable ? t('danger.body') : t('danger.lifecycleBody')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleArchive}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
        >
          <ArchiveIcon className="h-4 w-4" strokeWidth={1.75} />
          {archived ? t('danger.unarchive') : t('danger.archive')}
        </button>
        {deletable ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md border border-danger/40 px-3 py-2 text-sm text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            {t('danger.delete')}
          </button>
        ) : null}
      </div>
      {errorKey ? (
        <p className="text-xs text-danger">{t(`errors.${errorKey}`)}</p>
      ) : null}
    </div>
  );
}
