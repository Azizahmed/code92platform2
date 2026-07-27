'use client';

import {BookOpen, Download, ExternalLink} from 'lucide-react';
import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import {Link} from '@/i18n/navigation';
import {signPhaseArtifactAction} from '@/lib/actions/lifecycle';
import type {PhaseArtifact} from '@/lib/actions/lifecycle';

const BASE_CLASS =
  'inline-flex max-w-full items-center gap-2 rounded-md border border-hairline bg-raised px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink';

// An artifact points at exactly one of three things. Only the uploaded-file
// case needs a signed URL: the bucket is private, so there is no durable link
// to render — mint one at click time. Opening the tab first keeps Safari from
// treating the deferred navigation as a popup.
export default function ArtifactLink({artifact}: {artifact: PhaseArtifact}) {
  const t = useTranslations('lifecycle');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (artifact.knowledge_item_id) {
    return (
      <Link
        href={`/knowledge/${artifact.knowledge_item_id}`}
        className={BASE_CLASS}
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span dir="auto" className="truncate">
          {artifact.title}
        </span>
      </Link>
    );
  }

  if (artifact.url) {
    return (
      <a
        href={artifact.url}
        target="_blank"
        rel="noreferrer"
        className={BASE_CLASS}
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span dir="auto" className="truncate">
          {artifact.title}
        </span>
      </a>
    );
  }

  function handleClick() {
    setErrorKey(null);
    const tab = window.open('', '_blank');

    startTransition(async () => {
      const result = await signPhaseArtifactAction(artifact.id);
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
    artifact.size_bytes != null
      ? `${Math.max(1, Math.round(artifact.size_bytes / 1024))} KB`
      : null;

  return (
    <span className="inline-flex max-w-full flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`${BASE_CLASS} disabled:opacity-50`}
      >
        <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span dir="auto" className="truncate">
          {pending ? t('artifacts.openFile') : artifact.title}
        </span>
        {sizeLabel ? (
          <span className="shrink-0 font-mono text-[10px] text-faint">
            {sizeLabel}
          </span>
        ) : null}
      </button>
      {errorKey ? (
        <span className="text-[11px] text-danger">
          {t(`errors.${errorKey}`)}
        </span>
      ) : null}
    </span>
  );
}
