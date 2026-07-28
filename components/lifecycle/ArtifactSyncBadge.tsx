'use client';

import {useState, useTransition} from 'react';
import {Check, CloudOff, ExternalLink, RefreshCw, TriangleAlert} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {pushArtifactAction} from '@/lib/actions/github';
import {repoFileUrl, type SyncState} from '@/lib/github';

// Mirror state for one artifact. A failure stays visible and retryable here
// rather than disappearing: the lifecycle is never blocked by GitHub, so the
// only thing that stops a silent gap between the platform and the repo is
// showing the gap.
export default function ArtifactSyncBadge({
  artifactId,
  state,
  path,
  error,
  repo,
  branch,
  canEdit
}: {
  artifactId: string;
  state: SyncState;
  path: string | null;
  error: string | null;
  repo: string | null;
  branch: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations('github');
  const [pending, startTransition] = useTransition();
  const [localState, setLocalState] = useState<SyncState | null>(null);
  const [retried, setRetried] = useState(false);

  const current = localState ?? state;

  // Nothing useful to say when no repo is connected — the card above already
  // explains that, and a badge per artifact would just be noise.
  if (!repo) return null;

  function retry() {
    startTransition(async () => {
      const result = await pushArtifactAction(artifactId);
      setRetried(true);
      setLocalState(result.ok ? 'synced' : 'failed');
    });
  }

  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-faint">
        <RefreshCw className="h-2.5 w-2.5 animate-spin" strokeWidth={2} />
        {t('sync.syncing')}
      </span>
    );
  }

  if (current === 'synced') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] text-accent">
        <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
        {t('sync.synced')}
        {path ? (
          <a
            href={repoFileUrl(repo, branch, path)}
            target="_blank"
            rel="noreferrer"
            dir="ltr"
            className="inline-flex items-center gap-0.5 hover:underline"
          >
            {t('sync.viewFile')}
            <ExternalLink className="h-2.5 w-2.5" strokeWidth={1.75} />
          </a>
        ) : null}
      </span>
    );
  }

  if (current === 'skipped') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-faint">
        <CloudOff className="h-2.5 w-2.5" strokeWidth={1.75} />
        {t('sync.skipped')}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[10px] text-amber">
      <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2} />
      {t(current === 'failed' ? 'sync.failed' : 'sync.pending')}
      {error && !retried ? (
        <span dir="ltr" className="max-w-64 truncate font-mono text-faint" title={error}>
          {error}
        </span>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          onClick={retry}
          className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          {t('sync.retry')}
        </button>
      ) : null}
    </span>
  );
}
