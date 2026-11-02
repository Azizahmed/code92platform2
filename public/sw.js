/* Code 92 Command Center service worker.
 *
 * Every page is dynamic and shows signed-in data, so pages are never cached:
 * a navigation always goes to the network, and only when the network fails
 * does the worker answer with the static offline page. That keeps one user's
 * data out of the cache on a shared device and never shows a stale session.
 *
 * What is cached:
 * - /_next/static/*  content-hashed build output (JS, CSS, fonts): cache-first.
 * - /icons/*         app icons: stale-while-revalidate.
 * - /offline.html    precached at install.
 *
 * Everything else (RSC payloads, server actions, /api/*, the InsForge backend)
 * is left to the browser untouched.
 *
 * Bump VERSION to drop every old cache on the next activation.
 */

const VERSION = 'v1';
const SHELL_CACHE = `code92-shell-${VERSION}`;
const STATIC_CACHE = `code92-static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const STATIC_LIMIT = 300;

const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, {cache: 'reload'}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('code92-') && !keep.has(name)).map((name) => caches.delete(name))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const {request} = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkWithOfflineFallback(event));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

async function networkWithOfflineFallback(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const offline = await caches.match(OFFLINE_URL, {cacheName: SHELL_CACHE});
    return offline ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cache, STATIC_LIMIT);
  }
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) ?? Response.error();
}

// Cache keys come back in insertion order, so dropping from the front evicts
// the oldest build's assets first.
async function trim(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) {
    await cache.delete(keys[i]);
  }
}
