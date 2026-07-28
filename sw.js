// A4 Signal Planner — Service Worker
// Cache-first strategy for the app shell (HTML document + manifest + icon).
// This does NOT cache or intercept POST requests — the Anthropic API calls
// (automated SV/SD/SR/QC, platform-rewrite assist) always pass straight
// through to the network, untouched, exactly as before.
//
// This is a single-page app: any navigation request (whatever the exact URL,
// path, or query string) is treated as a request for the same app shell, and
// is served from — and cached under — one fixed key. This avoids a real bug
// found during testing: caching the exact request URL meant a page reachable
// at a slightly different URL (e.g. "/index.html" vs "/") could silently miss
// the cache and mask staleness rather than reveal it.
//
// UPDATE PATH: this cache name is tied to a content hash of the HTML at build
// time (currently 63ca81602d). Regenerate this file with a new hash any time the
// HTML changes — a byte-identical sw.js will never be re-fetched by the
// browser, so an unchanged sw.js means an unchanged cache forever, even if
// the HTML itself was updated.

const CACHE_NAME = 'a4-signal-cache-63ca81602d';
const CACHE_PREFIX = 'a4-signal-cache-';
const SHELL_KEY = self.registration.scope; // fixed cache key for the app shell, regardless of actual request URL

const OFFLINE_FALLBACK_HTML =
  '<!doctype html><html><body style="background:#000;color:#C8922A;font-family:monospace;padding:24px;">' +
  '<h2>Offline</h2><p>This page has not been cached yet. Load it once while online to enable offline use.</p>' +
  '</body></html>';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache the app shell under the fixed SHELL_KEY, regardless of which
      // exact URL is used to fetch it during install.
      try {
        const shellResponse = await fetch(self.registration.scope);
        if (shellResponse && shellResponse.ok) {
          await cache.put(SHELL_KEY, shellResponse);
        }
      } catch (err) {
        console.warn('[SW] Failed to precache app shell', err);
      }
      // Secondary static assets — best-effort, independent of each other.
      await Promise.all(
        ['./manifest.webmanifest', './apple-touch-icon.png'].map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Precache failed for', url, err);
          })
        )
      );
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never touch non-GET requests (POST = Anthropic API calls). Let the
  // browser handle those exactly as it would with no service worker at all.
  if (req.method !== 'GET') return;

  // Page navigations: always resolve to the one app shell, cache-first,
  // regardless of the exact URL requested (this is a single-page app).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(SHELL_KEY).then((cachedShell) => {
        if (cachedShell) return cachedShell;
        return fetch(req).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_KEY, clone));
          }
          return response;
        }).catch(() => new Response(OFFLINE_FALLBACK_HTML, { headers: { 'Content-Type': 'text/html' } }));
      })
    );
    return;
  }

  // Everything else (manifest, icon, etc.): normal cache-first with runtime caching.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
    })
  );
});
