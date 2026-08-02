'use client';

import {useState, useTransition} from 'react';
import {X} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {
  createReleaseAction,
  updateReleaseAction
} from '@/lib/actions/releases';
import type {ReleaseOverview} from '@/lib/releases';

export type ReleaseMemberOption = {
  userId: string;
  displayName: string;
};

export type ReleaseProductOption = {
  id: string;
  name: string;
};

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

export default function ReleaseForm({
  productId,
  products,
  members,
  release,
  onDone
}: {
  // Fixed when the form opens from a product page; a picker on the board.
  productId?: string;
  products?: ReleaseProductOption[];
  members: ReleaseMemberOption[];
  release?: ReleaseOverview;
  onDone: () => void;
}) {
  const t = useTranslations('releases');
  const [selectedProduct, setSelectedProduct] = useState(
    productId ?? release?.product_id ?? products?.[0]?.id ?? ''
  );
  const [version, setVersion] = useState(release?.version ?? '');
  const [name, setName] = useState(release?.name ?? '');
  const [notes, setNotes] = useState(release?.notes ?? '');
  const [targetDate, setTargetDate] = useState(release?.target_date ?? '');
  const [ownerId, setOwnerId] = useState(release?.owner_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const payload = {
        version: version.trim(),
        name: name.trim() || null,
        notes: notes.trim() || null,
        targetDate: targetDate || null,
        ownerId: ownerId || null
      };

      const result = release
        ? await updateReleaseAction(release.id, payload)
        : await createReleaseAction({productId: selectedProduct, ...payload});

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-accent/20 bg-accent/[0.035] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          {release ? t('form.editTitle') : t('form.newTitle')}
        </h3>
        <button
          type="button"
          onClick={onDone}
          aria-label={t('form.cancel')}
          className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {/* The product is fixed once a release exists: its checklist was seeded
          from that product's risk tier, and moving it would silently change
          which rules it was held to. */}
      {!productId && !release && products ? (
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.product')}</span>
          <select
            required
            value={selectedProduct}
            onChange={(event) => setSelectedProduct(event.target.value)}
            className={INPUT_CLASS}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.version')}</span>
          <input
            autoFocus
            required
            dir="ltr"
            maxLength={60}
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder={t('form.versionPlaceholder')}
            className={`${INPUT_CLASS} font-mono text-start`}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('form.targetDate')}</span>
          <input
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t('form.name')}</span>
        <input
          maxLength={240}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('form.namePlaceholder')}
          className={INPUT_CLASS}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t('form.notes')}</span>
        <textarea
          rows={3}
          maxLength={5000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t('form.notesPlaceholder')}
          className={`${INPUT_CLASS} resize-y`}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t('form.owner')}</span>
        <select
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">{t('form.noOwner')}</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {release
            ? pending
              ? t('form.saving')
              : t('form.save')
            : pending
              ? t('form.creating')
              : t('form.create')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-hairline px-3.5 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          {t('form.cancel')}
        </button>
      </div>
    </form>
  );
}
