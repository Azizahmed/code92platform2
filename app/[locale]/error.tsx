'use client';

import {useEffect} from 'react';
import {AlertTriangle} from 'lucide-react';
import {useTranslations} from 'next-intl';

// Route-level error boundary for the [locale] segment. Keeps the dark console
// chrome (the shell renders above it) and offers a retry via reset().
export default function Error({
  error,
  reset
}: {
  error: Error & {digest?: string};
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    console.error('route error boundary caught', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-24 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-danger/30 bg-danger/10">
        <AlertTriangle className="h-5 w-5 text-danger" strokeWidth={1.5} />
      </span>
      <div className="text-sm font-medium">{t('states.errorTitle')}</div>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        {t('states.errorBody')}
      </p>
      {error.digest ? (
        <p dir="ltr" className="font-mono text-[11px] text-faint">
          {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
      >
        {t('states.retry')}
      </button>
    </div>
  );
}
