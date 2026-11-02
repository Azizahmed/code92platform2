'use client';

import {useTranslations} from 'next-intl';

import {setKnowledgeProductLinkAction} from '@/lib/actions/business';
import {useServerAction} from '@/lib/use-server-action';

// Where a linked document belongs: the business track, the development track, or
// one of this product's releases. Choosing a release makes it development.
export default function KnowledgeLinkEditor({
  productId,
  itemId,
  track,
  releaseId,
  releases,
  disabled
}: {
  productId: string;
  itemId: string;
  track: 'business' | 'development' | null;
  releaseId: string | null;
  releases: {id: string; version: string}[];
  disabled: boolean;
}) {
  const t = useTranslations('business');
  const [pending, run] = useServerAction();

  const save = (next: {track: 'business' | 'development' | null; releaseId: string | null}) => {
    void run(() =>
      setKnowledgeProductLinkAction({
        itemId,
        productId,
        track: next.track,
        releaseId: next.releaseId
      })
    );
  };

  const select =
    'rounded-md border border-hairline bg-bg px-2 py-1 text-[11px] outline-none focus:border-accent/50 disabled:opacity-50';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label={t('knowledge.track')}
        value={track ?? ''}
        disabled={disabled || pending}
        onChange={(event) => {
          const value = event.target.value as 'business' | 'development' | '';
          save({track: value || null, releaseId: value === 'business' ? null : releaseId});
        }}
        className={select}
      >
        <option value="">{t('knowledge.trackNone')}</option>
        <option value="business">{t('knowledge.tracks.business')}</option>
        <option value="development">{t('knowledge.tracks.development')}</option>
      </select>
      <select
        aria-label={t('knowledge.release')}
        value={releaseId ?? ''}
        disabled={disabled || pending || releases.length === 0}
        onChange={(event) => save({track: 'development', releaseId: event.target.value || null})}
        className={select}
      >
        <option value="">{t('knowledge.releaseNone')}</option>
        {releases.map((release) => (
          <option key={release.id} value={release.id}>
            {release.version}
          </option>
        ))}
      </select>
    </div>
  );
}
