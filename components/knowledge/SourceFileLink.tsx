'use client';

import {Download} from 'lucide-react';
import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import {signKnowledgeFileAction} from '@/lib/actions/knowledge';

// The knowledge-files bucket is private, so there is no durable link to
// render: mint a short-lived signed URL at click time and hand it to the
// browser. Opening the tab first keeps Safari from treating the deferred
// navigation as a popup.
export default function SourceFileLink({
  itemId,
  fileName,
  sizeBytes
}: {
  itemId: string;
  fileName: string;
  sizeBytes: number | null;
}) {
  const t = useTranslations('knowledge');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setErrorKey(null);
    const tab = window.open('', '_blank');

    startTransition(async () => {
      const result = await signKnowledgeFileAction(itemId);
      if (!result.ok) {
        tab?.close();
        setErrorKey(result.error);
        return;
      }
      if (tab) {
        tab.location.href = result.url;
      } else {
        window.location.href = result.url;
      }
    });
  }

  const sizeLabel =
    sizeBytes != null ? `${Math.max(1, Math.round(sizeBytes / 1024))} KB` : null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-hairline bg-raised px-3 py-2 text-sm text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50"
      >
        <Download className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span dir="auto" className="truncate">
          {pending ? t('file.opening') : fileName}
        </span>
        {sizeLabel ? (
          <span className="font-mono text-[11px] text-faint">{sizeLabel}</span>
        ) : null}
      </button>
      {errorKey ? (
        <p className="text-xs text-danger">{t(`errors.${errorKey}`)}</p>
      ) : null}
    </div>
  );
}
