'use client';

import {useState, useTransition} from 'react';
import {Loader2, Radar} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {scanNowAction, type ScanNowResult} from '@/lib/actions/admin';

// Manual "Scan now": invokes the trend-scan edge function with the admin's
// JWT and shows the run summary. The function itself rejects non-admins.
export default function ScanNowButton() {
  const t = useTranslations('admin');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ScanNowResult | null>(null);

  function handleScan() {
    startTransition(async () => {
      setResult(await scanNowAction());
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleScan}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <Radar className="h-4 w-4" strokeWidth={1.75} />
        )}
        {pending ? t('scanNow.scanning') : t('scanNow.button')}
      </button>

      {result ? (
        result.ok ? (
          <div className="rounded-md border border-hairline bg-raised px-3 py-2 text-xs">
            <span className="font-medium text-ink">
              {t('scanNow.result')} · {t(`scans.statuses.${result.status}`)}
            </span>{' '}
            <span className="font-mono text-muted">
              {t('scanNow.resultCounts', {
                products: result.productsScanned,
                inserted: result.itemsInserted,
                linked: result.itemsLinked
              })}
            </span>
          </div>
        ) : (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {t.has(`errors.${result.error}`)
              ? t(`errors.${result.error}`)
              : t('errors.generic')}
          </div>
        )
      ) : null}
    </div>
  );
}
