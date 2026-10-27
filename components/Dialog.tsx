'use client';

import {useEffect, type ReactNode} from 'react';
import {X} from 'lucide-react';
import {useTranslations} from 'next-intl';

// The one modal shell the 0.3 screens share: a dimmed backdrop, a panel that
// sits at the bottom on phones and in the middle on larger screens, and Escape
// to close. Content and buttons belong to the caller.
export default function Dialog({
  title,
  subtitle,
  onClose,
  children,
  wide = false
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"
    >
      <button
        type="button"
        aria-label={t('actions.cancel')}
        onClick={onClose}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      <div
        className={`relative max-h-[85vh] w-full overflow-y-auto rounded-xl border border-hairline bg-panel p-5 shadow-2xl ${
          wide ? 'max-w-2xl' : 'max-w-md'
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('actions.cancel')}
            className="rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
