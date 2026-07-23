'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import {type Stage} from '@/components/StageChip';
import {Link, useRouter} from '@/i18n/navigation';
import {
  createProductAction,
  updateProductAction,
  type ProductStage
} from '@/lib/actions/products';

export type ProductFormInitial = {
  name: string;
  slug: string;
  description: string | null;
  descriptionAr: string | null;
  category: string | null;
  stage: ProductStage;
  keywords: string[];
  links: Record<string, string>;
  reviewIntervalDays: number;
  trendScanEnabled: boolean;
  ownerId: string;
};

export type MemberOption = {userId: string; displayName: string};

const STAGES: Stage[] = [
  'idea',
  'development',
  'beta',
  'live',
  'paused',
  'sunset'
];

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';
const LABEL_CLASS = 'block space-y-1.5';
const LABEL_TEXT_CLASS = 'text-xs text-muted';
const HINT_CLASS = 'text-[11px] text-faint';

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

type Props =
  | {mode: 'create'; members: MemberOption[]; isAdmin: boolean}
  | {
      mode: 'edit';
      productId: string;
      initial: ProductFormInitial;
      members: MemberOption[];
      isAdmin: boolean;
    };

export default function ProductForm(props: Props) {
  const t = useTranslations('products');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const initial: ProductFormInitial =
    props.mode === 'edit'
      ? props.initial
      : {
          name: '',
          slug: '',
          description: null,
          descriptionAr: null,
          category: null,
          stage: 'idea',
          keywords: [],
          links: {},
          reviewIntervalDays: 14,
          trendScanEnabled: true,
          ownerId: ''
        };

  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(props.mode === 'edit');
  const [description, setDescription] = useState(initial.description ?? '');
  const [descriptionAr, setDescriptionAr] = useState(initial.descriptionAr ?? '');
  const [category, setCategory] = useState(initial.category ?? '');
  const [stage, setStage] = useState<Stage>(initial.stage);
  const [keywordsText, setKeywordsText] = useState(initial.keywords.join(', '));
  const [linksText, setLinksText] = useState(
    Object.keys(initial.links).length
      ? JSON.stringify(initial.links, null, 2)
      : ''
  );
  const [reviewIntervalDays, setReviewIntervalDays] = useState(
    String(initial.reviewIntervalDays)
  );
  const [trendScanEnabled, setTrendScanEnabled] = useState(
    initial.trendScanEnabled
  );
  const [ownerId, setOwnerId] = useState(initial.ownerId);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function parseLinks(): Record<string, string> | null {
    const text = linksText.trim();
    if (!text) return {};
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
      }
      for (const [key, url] of Object.entries(value)) {
        if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
        if (!key.trim()) return null;
      }
      return value as Record<string, string>;
    } catch {
      return null;
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);

    const links = parseLinks();
    if (links === null) {
      setErrorKey('linksInvalid');
      return;
    }

    const keywords = keywordsText
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    const interval = Number(reviewIntervalDays);
    const payload = {
      name,
      slug,
      description: description.trim() === '' ? null : description.trim(),
      descriptionAr: descriptionAr.trim() === '' ? null : descriptionAr.trim(),
      category: category.trim() === '' ? null : category.trim(),
      stage: stage as ProductStage,
      keywords,
      links,
      reviewIntervalDays: interval,
      trendScanEnabled
    };

    startTransition(async () => {
      const result =
        props.mode === 'create'
          ? await createProductAction(payload)
          : await updateProductAction(props.productId, {
              ...payload,
              ownerId: ownerId || undefined
            });

      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      router.push(`/products/${result.productId}`);
      router.refresh();
    });
  }

  const intervalInvalid =
    !Number.isInteger(Number(reviewIntervalDays)) ||
    Number(reviewIntervalDays) < 1 ||
    Number(reviewIntervalDays) > 365;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-lg border border-hairline bg-panel p-6"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.name')}</span>
          <input
            type="text"
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(deriveSlug(e.target.value));
            }}
            placeholder={t('fields.namePlaceholder')}
            className={INPUT_CLASS}
          />
        </label>

        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.slug')}</span>
          <input
            type="text"
            required
            dir="ltr"
            maxLength={80}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            className={`${INPUT_CLASS} font-mono`}
          />
          <span className={HINT_CLASS}>{t('fields.slugHint')}</span>
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.description')}</span>
          <textarea
            rows={3}
            maxLength={2000}
            dir="ltr"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${INPUT_CLASS} resize-y`}
          />
        </label>
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.descriptionAr')}</span>
          <textarea
            rows={3}
            maxLength={2000}
            dir="rtl"
            value={descriptionAr}
            onChange={(e) => setDescriptionAr(e.target.value)}
            className={`${INPUT_CLASS} resize-y`}
          />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.category')}</span>
          <input
            type="text"
            maxLength={80}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t('fields.categoryPlaceholder')}
            className={INPUT_CLASS}
          />
        </label>

        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.stage')}</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            className={INPUT_CLASS}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {tCommon(`stages.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT_CLASS}>{t('fields.keywords')}</span>
        <input
          type="text"
          value={keywordsText}
          onChange={(e) => setKeywordsText(e.target.value)}
          className={INPUT_CLASS}
        />
        <span className={HINT_CLASS}>{t('fields.keywordsHint')}</span>
      </label>

      <label className={LABEL_CLASS}>
        <span className={LABEL_TEXT_CLASS}>{t('fields.links')}</span>
        <textarea
          rows={3}
          dir="ltr"
          value={linksText}
          onChange={(e) => setLinksText(e.target.value)}
          placeholder='{"website": "https://…"}'
          className={`${INPUT_CLASS} resize-y font-mono text-xs`}
        />
        <span className={HINT_CLASS}>{t('fields.linksHint')}</span>
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.reviewInterval')}</span>
          <input
            type="number"
            required
            min={1}
            max={365}
            dir="ltr"
            value={reviewIntervalDays}
            onChange={(e) => setReviewIntervalDays(e.target.value)}
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>

        <label className="flex items-end gap-2.5 pb-2">
          <input
            type="checkbox"
            checked={trendScanEnabled}
            onChange={(e) => setTrendScanEnabled(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm text-muted">{t('fields.trendScan')}</span>
        </label>
      </div>

      {props.mode === 'edit' ? (
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>{t('fields.owner')}</span>
          {props.isAdmin ? (
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className={INPUT_CLASS}
            >
              {props.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          ) : (
            <>
              <div className="rounded-md border border-hairline bg-bg px-3 py-2 text-sm text-muted">
                {props.members.find((m) => m.userId === initial.ownerId)
                  ?.displayName ?? '—'}
              </div>
              <span className={HINT_CLASS}>{t('edit.ownerAdminOnly')}</span>
            </>
          )}
        </label>
      ) : null}

      {errorKey ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || intervalInvalid}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? props.mode === 'create'
              ? t('new.submitting')
              : t('edit.submitting')
            : props.mode === 'create'
              ? t('new.submit')
              : t('edit.submit')}
        </button>
        <Link
          href={
            props.mode === 'edit' ? `/products/${props.productId}` : '/products'
          }
          className="rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          {tCommon('actions.cancel')}
        </Link>
      </div>
    </form>
  );
}
