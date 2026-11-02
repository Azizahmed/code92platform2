'use client';

import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {useConfirm} from '@/components/ui/ConfirmProvider';
import RelativeTime from '@/components/RelativeTime';
import {addReleaseArtifactAction, removeReleaseArtifactAction} from '@/lib/actions/releases';
import {
  ARTIFACT_KEYS,
  ARTIFACT_STAGE,
  CARRY_KEYS,
  releaseStageIndex,
  type ArtifactKey,
  type ReleaseArtifact,
  type ReleaseStage
} from '@/lib/releases';
import {useServerAction} from '@/lib/use-server-action';

// The evidence for one stage: what is filed, what is still required, and the
// form to file more. Only the release's current stage can have items taken back;
// earlier stages are closed and their evidence stays on the record.
export default function StageArtifacts({
  releaseId,
  currentStage,
  stage,
  artifacts,
  required,
  canManage
}: {
  releaseId: string;
  currentStage: ReleaseStage;
  stage: ReleaseStage;
  artifacts: ReleaseArtifact[];
  required: ArtifactKey[];
  canManage: boolean;
}) {
  const t = useTranslations('releases');
  const confirm = useConfirm();
  const [key, setKey] = useState<ArtifactKey>(required[0] ?? 'intent');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [commit, setCommit] = useState('');
  const [carry, setCarry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const filable = ARTIFACT_KEYS.filter(
    (item) => releaseStageIndex(ARTIFACT_STAGE[item]) <= releaseStageIndex(currentStage)
  );
  const here = stage === currentStage;
  const valid = title.trim().length > 0 && url.trim().length > 0;
  const input =
    'w-full rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-faint focus:border-accent/50';

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {artifacts.length === 0 ? <li className="text-xs text-faint">{t('artifacts.none')}</li> : null}
        {artifacts.map((artifact) => (
          <li key={artifact.id} className="flex items-start gap-2 rounded-md border border-hairline px-3 py-2 text-xs">
            <span className="shrink-0 rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">
              {t(`artifacts.${artifact.artifact_key}`)}
            </span>
            <span className="min-w-0 flex-1">
              {artifact.url ? (
                <a href={artifact.url} target="_blank" rel="noreferrer" className="block truncate text-ink hover:text-accent">
                  {artifact.title}
                </a>
              ) : (
                <span className="block truncate text-ink">{artifact.title}</span>
              )}
              <span className="block text-[10px] text-faint">
                {artifact.commit_ref ? <span className="font-mono">{artifact.commit_ref} · </span> : null}
                <RelativeTime date={artifact.created_at} />
                {artifact.carry_to_next ? <span> · {t('artifacts.carried')}</span> : null}
              </span>
            </span>
            {canManage && artifact.stage === currentStage ? (
              <button
                type="button"
                disabled={pending}
                aria-label={t('artifacts.remove')}
                onClick={async () => {
                  if (!await confirm(t('artifacts.removeConfirm'))) return;
                  void run(async () => {
                    const result = await removeReleaseArtifactAction(artifact.id);
                    if (!result.ok) setError(result.error);
                  });
                }}
                className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-danger"
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.75} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage && here ? (
        <form
          className="grid gap-2 rounded-md border border-dashed border-hairline p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            setError(null);
            void run(async () => {
              const result = await addReleaseArtifactAction({
                releaseId,
                key,
                title: title.trim(),
                url: url.trim(),
                commitRef: commit.trim() || null,
                carryToNext: carry
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setTitle('');
              setUrl('');
              setCommit('');
              setCarry(false);
            });
          }}
        >
          <select value={key} onChange={(event) => setKey(event.target.value as ArtifactKey)} aria-label={t('artifacts.kind')} className={input}>
            {filable.map((item) => (
              <option key={item} value={item}>
                {t(`artifacts.${item}`)}
                {required.includes(item) ? ` · ${t('artifacts.requiredTag')}` : ''}
              </option>
            ))}
          </select>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder={t('artifacts.title')} aria-label={t('artifacts.title')} className={input} />
          <input value={url} onChange={(event) => setUrl(event.target.value)} type="url" placeholder="https://" dir="ltr" aria-label={t('artifacts.url')} className={input} />
          <input value={commit} onChange={(event) => setCommit(event.target.value)} maxLength={100} placeholder={t('artifacts.commit')} dir="ltr" aria-label={t('artifacts.commit')} className={input} />
          {CARRY_KEYS.includes(key) ? (
            <label className="flex items-center gap-2 text-xs text-muted sm:col-span-2">
              <input type="checkbox" checked={carry} onChange={(event) => setCarry(event.target.checked)} className="accent-accent" />
              {t('artifacts.carryHint')}
            </label>
          ) : null}
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            {error ? <span role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</span> : <span />}
            <button type="submit" disabled={pending || !valid} className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
              {t('artifacts.file')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
