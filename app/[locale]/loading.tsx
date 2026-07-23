import {Loader2} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

// Route-level loading state for the whole [locale] segment: a quiet spinner,
// matching the dark console aesthetic (no layout shift, no extra texture).
export default async function Loading() {
  const t = await getTranslations('common');

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center"
    >
      <Loader2
        className="h-5 w-5 animate-spin text-accent"
        strokeWidth={1.75}
      />
      <span className="text-xs text-muted">{t('states.loading')}</span>
    </div>
  );
}
