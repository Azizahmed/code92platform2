'use client';

import {routing} from '@/i18n/routing';

// Next 15.5's router intermittently leaves a navigation that follows a
// revalidating server action uncommitted: the old page stays up though the
// record is saved (IMPLEMENTATION_PLAN.md, Known issues). These helpers let
// Next navigate as usual and, only if the URL has not moved, load the
// destination outright.

// A redirect's response already carries the destination page, so only
// rendering is left; a client push still has to fetch it.
export const REDIRECT_COMMIT_MS = 1500;
export const PUSH_COMMIT_MS = 5000;

const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join('|')})(/|$)`);

// Locale-less hrefs (what the next-intl router takes) get the current locale.
function resolve(href: string): URL {
  if (/^[a-z]+:/i.test(href) || LOCALE_PREFIX.test(href)) return new URL(href, window.location.href);
  const locale = window.location.pathname.match(LOCALE_PREFIX)?.[1] ?? routing.defaultLocale;
  return new URL(`/${locale}${href === '/' ? '' : href}`, window.location.href);
}

export function guardNavigation(href: string, ms: number): void {
  const target = resolve(href);
  const origin = window.location.pathname;
  window.setTimeout(() => {
    // Still on the page the save started from: the navigation never landed.
    // Anywhere else means it did, or the person has moved on themselves.
    if (window.location.pathname === origin && origin !== target.pathname) {
      window.location.assign(target.href);
    }
  }, ms);
}

// The URL a server action redirected to, read the way Next encodes it:
// digest = 'NEXT_REDIRECT;<type>;<url>;<status>;'.
export function redirectTarget(error: unknown): string | null {
  const digest = (error as {digest?: unknown} | null)?.digest;
  if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT;')) return null;
  return digest.split(';').slice(2, -2).join(';') || null;
}

// router.push() after a server action, with the same landing guarantee.
export function pushAfterAction(router: {push: (href: string) => void}, href: string): void {
  router.push(href);
  guardNavigation(href, PUSH_COMMIT_MS);
}
