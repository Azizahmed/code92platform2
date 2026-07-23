'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import {type Health} from '@/components/HealthBadge';
import {type Stage} from '@/components/StageChip';
import {useRouter} from '@/i18n/navigation';
import {postStatusUpdateAction} from '@/lib/actions/status-updates';

const HEALTHS: Health[] = ['green', 'yellow', 'red', 'unknown'];
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

export default function StatusUpdateForm({productId}: {productId: string}) {
  const t = useTranslations('products');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [health, setHealth] = useState<Health>('green');
  const [stage, setStage] = useState<'' | Stage>('');
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setPosted(false);

    startTransition(async () => {
      const result = await postStatusUpdateAction({
        productId,
        health,
        stage: stage === '' ? null : stage,
        summary,
        details: details.trim() === '' ? null : details
      });

      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      // The AFTER INSERT trigger already moved product health/stage and
      // next_review_at; revalidatePath in the action plus this refresh
      // re-render the header and timeline with those effects.
      setSummary('');
      setDetails('');
      setStage('');
      setPosted(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-hairline bg-panel p-5"
    >
      <h2 className="text-sm font-medium">{t('update.title')}</h2>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('update.health')}</span>
          <select
            value={health}
            onChange={(e) => setHealth(e.target.value as Health)}
            className={INPUT_CLASS}
          >
            {HEALTHS.map((h) => (
              <option key={h} value={h}>
                {tCommon(`health.${h}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('update.stage')}</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as '' | Stage)}
            className={INPUT_CLASS}
          >
            <option value="">{t('update.stageUnchanged')}</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {tCommon(`stages.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t('update.summary')}</span>
        <input
          type="text"
          required
          maxLength={500}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder={t('update.summaryPlaceholder')}
          className={INPUT_CLASS}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">{t('update.details')}</span>
        <textarea
          rows={4}
          maxLength={5000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t('update.detailsPlaceholder')}
          className={`${INPUT_CLASS} resize-y`}
        />
      </label>

      {errorKey ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}
      {posted && !errorKey ? (
        <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
          {t('update.posted')}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t('update.submitting') : t('update.submit')}
      </button>
    </form>
  );
}
