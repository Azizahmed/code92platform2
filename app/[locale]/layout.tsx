import type {Metadata} from 'next';
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic
} from 'next/font/google';
import {notFound} from 'next/navigation';
import {hasLocale, NextIntlClientProvider} from 'next-intl';
import {getTranslations} from 'next-intl/server';

import AppShell from '@/components/AppShell';
import {routing} from '@/i18n/routing';
import {getOwnMembership, getSessionUser} from '@/lib/auth';

import '../globals.css';

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

export async function generateMetadata({
  params
}: {
  params: Promise<{locale: string}>;
}): Promise<Metadata> {
  const {locale} = await params;
  const t = await getTranslations({locale, namespace: 'common'});
  return {title: t('appName')};
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

  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);

  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className={`${plexSans.variable} ${plexArabic.variable} ${plexMono.variable}`}
    >
      <body>
        <NextIntlClientProvider>
          <AppShell
            userName={member?.display_name ?? null}
            userEmail={user?.email ?? null}
            isAdmin={Boolean(member?.is_active && member.role === 'admin')}
          >
            {children}
          </AppShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
