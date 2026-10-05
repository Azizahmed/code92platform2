import {NextResponse, type NextRequest} from 'next/server';
import createMiddleware from 'next-intl/middleware';
import {
  getAccessTokenCookieName,
  getRefreshTokenCookieName,
  updateSession
} from '@insforge/sdk/ssr/middleware';

import {routing} from '@/i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  // The assistant is a cookie-authenticated API route. Refresh its session
  // without applying locale redirects (all other APIs retain their own flow).
  if (request.nextUrl.pathname === '/api/assistant' || request.nextUrl.pathname === '/api/assistant/attachments') {
    const response = NextResponse.next();
    await updateSession({
      requestCookies: {get: (name: string) => request.cookies.get(name)},
      responseCookies: response.cookies
    });
    return response;
  }
  // 1. Locale routing (redirects/rewrites unprefixed paths itself).
  const response = intlMiddleware(request);

  // 2. Refresh the InsForge session so Server Components see fresh cookies.
  await updateSession({
    // Next's RequestCookies has an incompatible `set` signature; the SDK
    // only reads from this side, so hand it a plain reader.
    requestCookies: {get: (name: string) => request.cookies.get(name)},
    responseCookies: response.cookies
  });

  // 3. Auth gate for locale-prefixed pages.
  const segments = request.nextUrl.pathname.split('/');
  const locale = segments[1];
  if (!(routing.locales as readonly string[]).includes(locale)) {
    return response;
  }

  const rest = `/${segments.slice(2).join('/')}`;
  const isLogin = rest === '/login' || rest.startsWith('/login/');

  // The refresh token is the durable session signal; the access token is
  // short-lived and gets refreshed by updateSession above.
  const hasSession = Boolean(
    request.cookies.get(getRefreshTokenCookieName())?.value ??
      request.cookies.get(getAccessTokenCookieName())?.value
  );

  if (!hasSession && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    const redirectResponse = NextResponse.redirect(url);
    // Carry over any cookies updateSession just wrote.
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  // Signed-in users are sent away from /login by the login page itself
  // (middleware can't tell active members from pending ones without a
  // database round-trip, and pending members must reach /login to see the
  // "awaiting approval" state).
  return response;
}

export const config = {
  // Skip API routes, Next internals, and files with an extension.
  matcher: ['/api/assistant', '/api/assistant/attachments', '/((?!api|_next|_vercel|.*\\..*).*)']
};
