'use client';

import {useState, useTransition} from 'react';
import {Pencil, Trash2} from 'lucide-react';
import {useTranslations} from 'next-intl';

import ReleaseForm, {
  type ReleaseMemberOption
} from '@/components/releases/ReleaseForm';
import {useRouter} from '@/i18n/navigation';
import {deleteReleaseAction} from '@/lib/actions/releases';
import type {ReleaseOverview} from '@/lib/releases';

export default function ReleaseHeaderActions({
  release,
  members
}: {
  release: ReleaseOverview;
  members: ReleaseMemberOption[];
}) {
  const t = useTranslations('releases');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A released version is a historical fact. The RLS policy refuses the delete
  // outright; hiding the button means the refusal is never the way somebody
  // finds that out.
  const deletable = release.status !== 'released';

  function remove() {
    if (!window.confirm(t('deleteConfirm', {version: release.version}))) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteReleaseAction(release.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push('/releases');
      router.refresh();
    });
  }

  if (editing) {
    return (
      <ReleaseForm
        release={release}
        members={members}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t('edit')}
          title={t('edit')}
          className="rounded-md border border-hairline p-2 text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.75} />
        </button>
        {deletable ? (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={t('delete')}
            title={t('delete')}
            className="rounded-md border border-hairline p-2 text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
