import {defineRouting} from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ar'],
  defaultLocale: 'en',
  // Unprefixed visits start in English regardless of browser language.
  // Explicit /ar links and the language switcher remain available.
  localeDetection: false
});

export type Locale = (typeof routing.locales)[number];
