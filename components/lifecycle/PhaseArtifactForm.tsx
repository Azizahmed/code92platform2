'use client';

import {Paperclip} from 'lucide-react';
import {useRef, useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import {addPhaseArtifactAction} from '@/lib/actions/lifecycle';
import {
  removeArtifactFile,
  uploadArtifactFile,
  validateArtifactFile
} from '@/lib/lifecycle-upload';
import {
  artifactTypesForPhase,
  type ArtifactType,
  type LifecyclePhase
} from '@/lib/lifecycle';

export type KnowledgeOption = {id: string; title: string};

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

const UPLOAD_ERRORS = ['fileSize', 'fileType', 'uploadFailed'];

type Source = 'file' | 'url' | 'knowledge';

export default function PhaseArtifactForm({
  phaseId,
  phase,
  knowledgeOptions,
  onDone
}: {
  phaseId: string;
  phase: LifecyclePhase;
  knowledgeOptions: KnowledgeOption[];
  onDone: () => void;
}) {
  const t = useTranslations('lifecycle');
  const types = artifactTypesForPhase(phase);

  const [artifactType, setArtifactType] = useState<ArtifactType>(types[0]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState<Source>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [knowledgeItemId, setKnowledgeItemId] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);

    if (source === 'file' && !file) return setErrorKey('invalid');
    if (source === 'url' && url.trim() === '') return setErrorKey('invalid');
    if (source === 'knowledge' && knowledgeItemId === '') {
      return setErrorKey('invalid');
    }

    startTransition(async () => {
      let uploadedKey: string | null = null;
      try {
        const stored =
          source === 'file' && file
            ? await uploadArtifactFile(file, phase)
            : null;
        uploadedKey = stored?.key ?? null;

        const result = await addPhaseArtifactAction({
          phaseId,
          artifactType,
          title: title.trim(),
          notes: notes.trim() === '' ? null : notes.trim(),
          url: source === 'url' ? url.trim() : null,
          knowledgeItemId: source === 'knowledge' ? knowledgeItemId : null,
          file: stored
        });

        if (!result.ok) {
          // Don't leave an orphan object in the bucket the row never referenced.
          if (uploadedKey) await removeArtifactFile(uploadedKey);
          setErrorKey(result.error);
          return;
        }

        setTitle('');
        setNotes('');
        setUrl('');
        setKnowledgeItemId('');
        setFile(null);
        if (fileInput.current) fileInput.current.value = '';
        onDone();
      } catch (error) {
        if (uploadedKey) await removeArtifactFile(uploadedKey);
        setErrorKey(
          error instanceof Error && UPLOAD_ERRORS.includes(error.message)
            ? error.message
            : 'uploadFailed'
        );
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-hairline bg-bg/50 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('artifacts.typeLabel')}</span>
          <select
            value={artifactType}
            onChange={(event) =>
              setArtifactType(event.target.value as ArtifactType)
            }
            className={INPUT_CLASS}
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {t(`artifacts.types.${type}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('artifacts.titleLabel')}</span>
          <input
            type="text"
            required
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('artifacts.titlePlaceholder')}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-muted">{t('artifacts.sourceLabel')}</span>
        <div className="flex flex-wrap gap-1.5">
          {(['file', 'url', 'knowledge'] as Source[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setSource(option);
                setErrorKey(null);
              }}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                source === option
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-hairline text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {t(
                option === 'file'
                  ? 'artifacts.sourceFile'
                  : option === 'url'
                    ? 'artifacts.sourceUrl'
                    : 'artifacts.sourceKnowledge'
              )}
            </button>
          ))}
        </div>
      </div>

      {source === 'file' ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 rounded-md border border-dashed border-hairline bg-bg/50 px-3 py-3">
            <Paperclip className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
            <input
              ref={fileInput}
              type="file"
              accept=".md,.markdown,.txt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.json,.rtf,image/*,text/*"
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                if (next) {
                  const invalid = validateArtifactFile(next);
                  if (invalid) {
                    setErrorKey(invalid);
                    event.target.value = '';
                    setFile(null);
                    return;
                  }
                }
                setErrorKey(null);
                setFile(next);
              }}
              className="min-w-0 flex-1 text-xs text-muted file:me-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:bg-hairline"
            />
          </div>
          <p className="text-[11px] text-faint">{t('artifacts.fileHint')}</p>
        </div>
      ) : null}

      {source === 'url' ? (
        <label className="block space-y-1.5">
          <span className="sr-only">{t('artifacts.sourceUrl')}</span>
          <input
            type="url"
            dir="ltr"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t('artifacts.urlPlaceholder')}
            className={`${INPUT_CLASS} text-start`}
          />
        </label>
      ) : null}

      {source === 'knowledge' ? (
        <label className="block space-y-1.5">
          <span className="sr-only">{t('artifacts.sourceKnowledge')}</span>
          <select
            value={knowledgeItemId}
            onChange={(event) => setKnowledgeItemId(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">
              {knowledgeOptions.length === 0
                ? t('artifacts.knowledgeEmpty')
                : t('artifacts.knowledgePlaceholder')}
            </option>
            {knowledgeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t('artifacts.notesLabel')}</span>
        <textarea
          rows={2}
          maxLength={5000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t('artifacts.notesPlaceholder')}
          className={`${INPUT_CLASS} resize-y`}
        />
      </label>

      {errorKey ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? t('artifacts.submitting') : t('artifacts.submit')}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
        >
          {t('artifacts.cancel')}
        </button>
      </div>
    </form>
  );
}
