import type {Metadata, Viewport} from 'next';
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic
} from 'next/font/google';
import {notFound} from 'next/navigation';
import {hasLocale, NextIntlClientProvider} from 'next-intl';
import {getTranslations} from 'next-intl/server';

import AppShell from '@/components/AppShell';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import ConfirmProvider from '@/components/ui/ConfirmProvider';
import ToastProvider from '@/components/ui/ToastProvider';
import {routing} from '@/i18n/routing';
import {THEME_COLORS} from '@/lib/theme-colors';
import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {getMyWorkCounts} from '@/lib/my-work-counts';

import '../globals.css';

const themeBootScript = `
  (function () {
    try {
      var stored = localStorage.getItem('code92-theme');
      var theme = stored === 'light' || stored === 'dark'
        ? stored
        : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      document.documentElement.classList.add(theme);
    } catch (_) {
      theme = 'dark';
      document.documentElement.classList.add('dark');
    }
    // The browser/status bar follows the app's theme, not only the OS one.
    document.addEventListener('DOMContentLoaded', function () {
      var color = theme === 'light' ? '${THEME_COLORS.light}' : '${THEME_COLORS.dark}';
      document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
        m.setAttribute('content', color);
      });
    });
  })();
`;

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap'
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap'
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap'
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({locale}));
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    {media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark},
    {media: '(prefers-color-scheme: light)', color: THEME_COLORS.light}
  ]
};

export async function generateMetadata({
  params
}: {
  params: Promise<{locale: string}>;
}): Promise<Metadata> {
  const {locale} = await params;
  const t = await getTranslations({locale, namespace: 'common'});
  return {
    title: t('appName'),
    applicationName: t('appNameShort'),
    // iOS ignores the manifest for these. 'black' keeps the status bar solid,
    // so the sticky mobile header is not drawn under it.
    appleWebApp: {capable: true, title: t('appNameShort'), statusBarStyle: 'black'},
    formatDetection: {telephone: false}
  };
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // The My work badge rides in the same wave as get_me(): no added latency,
  // and getMyWorkCounts() returns before any call for anonymous requests.
  const [user, member, counts] = await Promise.all([
    getSessionUser(),
    getOwnMembership(),
    getMyWorkCounts()
  ]);

  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className={`${plexSans.variable} ${plexArabic.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{__html: themeBootScript}} />
      </head>
      <body>
        <ServiceWorkerRegister />
        <NextIntlClientProvider>
          <ToastProvider>
          <ConfirmProvider>
          <AppShell
            userName={member?.display_name ?? null}
            userEmail={user?.email ?? null}
            isAdmin={Boolean(member?.is_active && member.role === 'admin')}
            assistantUserId={member?.is_active ? user?.id ?? null : null}
            myWorkBadge={member?.is_active ? counts.badge : 0}
          >
            {children}
          </AppShell>
          </ConfirmProvider>
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
