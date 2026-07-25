'use client';

import {useState, useTransition} from 'react';
import {Archive, ArchiveRestore} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {setProductArchivedAction} from '@/lib/actions/products';

// Rendered for admins only (the page gates it); the server action and the
// DB trigger both re-check the admin role.
export default function ArchiveButton({
  productId,
  archived
}: {
  productId: string;
  archived: boolean;
}) {
  const t = useTranslations('products');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    const confirmed = window.confirm(
      archived ? t('edit.unarchiveConfirm') : t('edit.archiveConfirm')
    );
    if (!confirmed) return;
    setErrorKey(null);

    startTransition(async () => {
      const result = await setProductArchivedAction(productId, !archived);
      if (!result.ok) setErrorKey(result.error);
      // No router.refresh(): the action's revalidatePath already returns the
      // re-rendered page with the response.
    });
  }

  const Icon = archived ? ArchiveRestore : Archive;

  return (
    <div className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-5">
      <h2 className="text-sm font-medium text-danger">{t('edit.dangerZone')}</h2>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-danger/40 px-3 py-2 text-sm text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
        {pending
          ? t('edit.archiving')
          : archived
            ? t('edit.unarchive')
            : t('edit.archive')}
      </button>
      {errorKey ? (
        <p className="text-xs text-danger">{t(`errors.${errorKey}`)}</p>
      ) : null}
    </div>
  );
}
