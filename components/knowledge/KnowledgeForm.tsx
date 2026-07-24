'use client';

import {FileUp, Trash2} from 'lucide-react';
import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import ProductPicker, {
  type ProductOption
} from '@/components/knowledge/ProductPicker';
import TagPicker from '@/components/knowledge/TagPicker';
import {Link, useRouter} from '@/i18n/navigation';
import {
  createKnowledgeItemAction,
  updateKnowledgeItemAction,
  type KnowledgeTag
} from '@/lib/actions/knowledge';
import {
  defaultStatusForKind,
  isStatusForKind,
  statusesForKind,
  type KnowledgeKind,
  type KnowledgeStatus
} from '@/lib/knowledge';
import {
  removeKnowledgeFile,
  uploadKnowledgeFile,
  validateKnowledgeFile,
  type StoredFile
} from '@/lib/knowledge-upload';

export type KnowledgeFormInitial = {
  kind: KnowledgeKind;
  title: string;
  content: string | null;
  url: string | null;
  status: KnowledgeStatus;
  tagIds: string[];
  productIds: string[];
  file: StoredFile | null;
};

type Props =
  | {
      mode: 'create';
      tags: KnowledgeTag[];
      products: ProductOption[];
    }
  | {
      mode: 'edit';
      itemId: string;
      initial: KnowledgeFormInitial;
      tags: KnowledgeTag[];
      products: ProductOption[];
    };

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';
const LABEL_CLASS = 'block space-y-1.5';
const LABEL_TEXT_CLASS = 'text-xs text-muted';
const HINT_CLASS = 'text-[11px] text-faint';

const UPLOAD_ERROR_KEYS = ['fileType', 'fileSize', 'uploadFailed'];

export default function KnowledgeForm(props: Props) {
  const t = useTranslations('knowledge');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const initial: KnowledgeFormInitial =
    props.mode === 'edit'
      ? props.initial
      : {
          kind: 'article',
          title: '',
          content: null,
          url: null,
          status: 'draft',
          tagIds: [],
          productIds: [],
          file: null
        };

  const [kind, setKind] = useState<KnowledgeKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content ?? '');
  const [url, setUrl] = useState(initial.url ?? '');
  const [status, setStatus] = useState<KnowledgeStatus>(initial.status);
  const [tagIds, setTagIds] = useState<string[]>(initial.tagIds);
  const [productIds, setProductIds] = useState<string[]>(initial.productIds);
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isSource = kind === 'source';
  // A source can never become an article or a note (and vice versa) — the
  // database rejects it, so don't offer the choice.
  const kindOptions: KnowledgeKind[] =
    props.mode === 'edit'
      ? initial.kind === 'source'
        ? ['source']
        : ['article', 'note']
      : ['article', 'note', 'source'];

  const keepsExistingFile = Boolean(initial.file) && !removeFile && !file;

  function changeKind(next: KnowledgeKind) {
    setKind(next);
    if (!isStatusForKind(next, status)) setStatus(defaultStatusForKind(next));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);

    const trimmedUrl = url.trim();
    const trimmedContent = content.trim();

    if (isSource && !trimmedUrl && !file && !keepsExistingFile) {
      setErrorKey('sourceNeedsLinkOrFile');
      return;
    }
    if (!isSource && !trimmedContent) {
      setErrorKey('contentRequired');
      return;
    }

    startTransition(async () => {
      let uploaded: StoredFile | null = null;
      if (file) {
        try {
          uploaded = await uploadKnowledgeFile(file);
        } catch (error) {
          setErrorKey(
            error instanceof Error && UPLOAD_ERROR_KEYS.includes(error.message)
              ? error.message
              : 'uploadFailed'
          );
          return;
        }
      }

      const payload = {
        kind,
        title: title.trim(),
        content: trimmedContent === '' ? null : trimmedContent,
        url: isSource && trimmedUrl !== '' ? trimmedUrl : null,
        status,
        tagIds,
        productIds,
        file: uploaded ?? (keepsExistingFile ? initial.file : null)
      };

      const result =
        props.mode === 'create'
          ? await createKnowledgeItemAction(payload)
          : await updateKnowledgeItemAction(props.itemId, payload);

      if (!result.ok) {
        if (uploaded) await removeKnowledgeFile(uploaded.key);
        setErrorKey(result.error);
        return;
      }

      // The row no longer points at the old object — drop it from storage.
      if (result.previousFileKey) {
        await removeKnowledgeFile(result.previousFileKey);
      }

      router.push(`/knowledge/${result.itemId}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-lg border border-hairline bg-panel p-4 sm:p-6"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.kind')}</span>
          <select
            value={kind}
            disabled={kindOptions.length === 1}
            onChange={(event) => changeKind(event.target.value as KnowledgeKind)}
            className={`${INPUT_CLASS} disabled:opacity-60`}
          >
            {kindOptions.map((option) => (
              <option key={option} value={option}>
                {t(`kinds.${option}`)}
              </option>
            ))}
          </select>
          {props.mode === 'edit' && initial.kind === 'source' ? (
            <span className={HINT_CLASS}>{t('fields.kindLocked')}</span>
          ) : null}
        </label>

        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.status')}</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as KnowledgeStatus)
            }
            className={INPUT_CLASS}
          >
            {statusesForKind(kind).map((option) => (
              <option key={option} value={option}>
                {t(`statuses.${option}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT_CLASS}>{t('fields.title')}</span>
        <input
          type="text"
          required
          dir="auto"
          maxLength={240}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('fields.titlePlaceholder')}
          className={INPUT_CLASS}
        />
      </label>

      {isSource ? (
        <>
          <label className={LABEL_CLASS}>
            <span className={LABEL_TEXT_CLASS}>{t('fields.url')}</span>
            <input
              type="url"
              dir="ltr"
              maxLength={2000}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
              className={`${INPUT_CLASS} font-mono text-xs`}
            />
            <span className={HINT_CLASS}>{t('fields.urlHint')}</span>
          </label>

          <div className="rounded-md border border-hairline bg-bg/40 p-4">
            <div className="text-xs text-muted">{t('fields.file')}</div>
            <p className="mt-1 text-[11px] text-faint">
              {file?.name ??
                (keepsExistingFile ? initial.file?.fileName : null) ??
                t('fields.fileHint')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
                <FileUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                {keepsExistingFile ? t('fields.replaceFile') : t('fields.chooseFile')}
                <input
                  type="file"
                  className="sr-only"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0] ?? null;
                    if (!chosen) return;
                    const invalid = validateKnowledgeFile(chosen);
                    if (invalid) {
                      setErrorKey(invalid);
                      event.target.value = '';
                      return;
                    }
                    setErrorKey(null);
                    setFile(chosen);
                    setRemoveFile(false);
                  }}
                />
              </label>
              {file || keepsExistingFile ? (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setRemoveFile(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t('fields.removeFile')}
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT_CLASS}>
          {isSource ? t('fields.sourceNotes') : t('fields.content')}
        </span>
        <textarea
          dir="auto"
          rows={isSource ? 5 : 16}
          maxLength={100000}
          required={!isSource}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t('fields.contentPlaceholder')}
          className={`${INPUT_CLASS} resize-y leading-relaxed`}
        />
        <span className={HINT_CLASS}>{t('fields.contentHint')}</span>
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.tags')}</span>
          <TagPicker
            allTags={props.tags}
            selectedIds={tagIds}
            onChange={setTagIds}
            disabled={pending}
          />
        </div>

        <div className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.products')}</span>
          <ProductPicker
            products={props.products}
            selectedIds={productIds}
            onChange={setProductIds}
            disabled={pending}
          />
          <span className={HINT_CLASS}>{t('fields.productsHint')}</span>
        </div>
      </div>

      {errorKey ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? t('form.submitting')
            : props.mode === 'create'
              ? t('form.create')
              : t('form.save')}
        </button>
        <Link
          href={
            props.mode === 'edit' ? `/knowledge/${props.itemId}` : '/knowledge'
          }
          className="rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          {tCommon('actions.cancel')}
        </Link>
      </div>
    </form>
  );
}
