'use client';

import {useState} from 'react';
import {Pencil} from 'lucide-react';
import {useTranslations} from 'next-intl';

import ReleaseEditForm, {type ReleaseEditValues} from '@/components/releases/ReleaseEditForm';

export default function ReleaseEditButton({
  releaseId,
  initial,
  members,
  isAdmin
}: {
  releaseId: string;
  initial: ReleaseEditValues;
  members: {userId: string; displayName: string}[];
  isAdmin: boolean;
}) {
  const t = useTranslations('releases');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t('edit.action')}
      </button>
      {open ? (
        <ReleaseEditForm
          releaseId={releaseId}
          initial={initial}
          members={members}
          isAdmin={isAdmin}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
