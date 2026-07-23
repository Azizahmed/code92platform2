'use client';

import {useState, useTransition} from 'react';
import {Loader2, X} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {dismissTrendAction} from '@/lib/actions/trends';

type Props = {
  productId: string;
  trendItemId: string;
};

// Dismiss button for a product ↔ trend link. On success the Server Action
// revalidates, so the card disappears on its own; failures surface inline.
export default function DismissButton({productId, trendItemId}: Props) {
  const t = useTranslations('trends');
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function handleDismiss() {
    startTransition(async () => {
      const result = await dismissTrendAction({productId, trendItemId});
      setErrorKey(result.ok ? null : result.error);
    });
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDismiss}
        disabled={pending}
        title={t('card.dismiss')}
        className="rounded-md border border-hairline p-1.5 text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </button>
      {errorKey ? (
        <span className="text-[11px] text-danger">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t('errors.generic')}
        </span>
      ) : null}
    </span>
  );
}
