'use client';

import {useEffect} from 'react';
import {LogOut, SlidersHorizontal, X} from 'lucide-react';
import {useTranslations} from 'next-intl';

import LocaleSwitcher from '@/components/LocaleSwitcher';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import {Link} from '@/i18n/navigation';

// The quick control panel: the two things you actually change often (language
// and appearance), your identity, and a way out to the full settings page.
//
// One overlay for both breakpoints. It used to be a mobile-only sheet while
// desktop had the same controls inline in the sidebar — which meant two places
// to change the same setting and two places to keep in sync.
export default function ControlPanel({
  open,
  onClose,
  userName,
  userEmail,
  isAdmin,
  signingOut,
  onSignOut,
  moreLinks = []
}: {
  open: boolean;
  onClose: () => void;
  userName: string | null;
  userEmail: string | null;
  isAdmin: boolean;
  signingOut: boolean;
  onSignOut: () => void;
  // Navigation that does not fit the phone's bottom bar. Phones only: the
  // desktop sidebar already lists every item.
  moreLinks?: {href: string; label: string; icon: typeof X}[];
}) {
  const t = useTranslations('common');

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('nav.controlPanel')}
      className="fixed inset-0 z-50 flex items-end justify-center p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:items-center md:pb-3"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('nav.closePreferences')}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />

      {/* Bottom sheet on phones, centred card from md up. Centred with flex
          rather than a -translate-x-1/2, which is physical and would need an
          rtl: patch to sit correctly in Arabic. */}
      <div className="relative w-full rounded-2xl border border-hairline bg-panel p-4 shadow-2xl md:w-80">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t('nav.controlPanel')}</div>
            <div className="mt-0.5 truncate text-[11px] text-faint">
              {userName ?? userEmail ?? '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('nav.closePreferences')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {moreLinks.length > 0 ? (
          <nav aria-label={t('nav.more')} className="mb-4 md:hidden">
            <ul className="grid grid-cols-2 gap-2">
              {moreLinks.map(({href, label, icon: Icon}) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onClose}
                    className="flex min-h-11 items-center gap-2.5 rounded-md border border-hairline px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="space-y-3">
          <LocaleSwitcher />
          <ThemeSwitcher />

          <Link
            href="/settings"
            onClick={onClose}
            className="flex min-h-11 w-full items-center gap-2 rounded-md border border-hairline px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-start">
              {t('nav.settings')}
            </span>
            {isAdmin ? (
              <span className="shrink-0 rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">
                {t('nav.admin')}
              </span>
            ) : null}
          </Link>

          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            {t('actions.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
