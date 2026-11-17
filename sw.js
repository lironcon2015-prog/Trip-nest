/* TripNest Service Worker — offline-first shell so tickets open with no signal. */
const CACHE_VERSION = '2.0.2';
const CACHE_NAME = `tripnest-${CACHE_VERSION}`;

const CORE = [
  './', './index.html', './css/style.css', './manifest.json', './version.json',
  './js/merge.js', './js/db.js', './js/ui.js', './js/gemini.js', './js/mrz.js', './js/google.js', './js/server.js', './js/archive.js', './js/members.js', './js/vault.js',
  './js/documents.js', './js/food.js', './js/itinerary.js', './js/fx.js', './js/trips.js', './js/agent.js', './js/settings.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png',
  // pdf.js is self-hosted and precached so tickets open with no signal; the
  // worker and substitute fonts load lazily, so runtime caching isn't enough
  './lib/pdfjs/pdf.min.js', './lib/pdfjs/pdf.worker.min.js',
  ...['FoxitDingbats', 'FoxitFixed', 'FoxitFixedBold', 'FoxitFixedBoldItalic', 'FoxitFixedItalic',
    'FoxitSerif', 'FoxitSerifBold', 'FoxitSerifBoldItalic', 'FoxitSerifItalic', 'FoxitSymbol']
    .map(f => `./lib/pdfjs/standard_fonts/${f}.pfb`),
  ...['Regular', 'Bold', 'Italic', 'BoldItalic'].map(f => `./lib/pdfjs/standard_fonts/LiberationSans-${f}.ttf`),
  // cmaps (CJK PDFs) are rare — served same-origin and runtime-cached on first use
];

// hosts that must never be cached (bridge, APIs). Exact host or a subdomain of it —
// a bare 'googleapis.com' here used to swallow fonts.googleapis.com as well.
const BYPASS = ['script.google.com', 'script.googleusercontent.com', 'generativelanguage.googleapis.com', 'navigo.lironcon.com'];
const bypassed = (host) => BYPASS.some(h => host === h || host.endsWith('.' + h));

// third-party assets the shell needs offline (Tailwind, fonts, OCR) — runtime-cached
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  // cache:'no-cache' — fill the new cache from the server, never from a
  // possibly-stale HTTP cache (Safari serves Pages' max-age=600 copies).
  // Any failed or non-OK file fails the install: the old version keeps running
  // instead of activating a half-filled cache that breaks offline.
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => Promise.all(CORE.map(u =>
        fetch(u, { cache: 'no-cache' }).then(r => {
          if (!r.ok) throw new Error(`precache ${u}: HTTP ${r.status}`);
          return c.put(u, r);
        })
      )))
      .then(() => self.skipWaiting())
  );
});

// the app's update banner asks the new SW to take over immediately
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Before dropping an old cache, carry over what this version did not precache:
// Tailwind, fonts and OCR files (cross-origin), and pdf.js files fetched on
// demand (./lib/). Deleting them made the first launch after an update — at
// the airport, in flight mode — open without styles. App files never carry
// over: each version brings its own.
async function carryOver() {
  const fresh = await caches.open(CACHE_NAME);
  for (const k of await caches.keys()) {
    if (k === CACHE_NAME) continue;
    try {
      const old = await caches.open(k);
      for (const req of await old.keys()) {
        const u = new URL(req.url);
        const keep = u.origin !== self.location.origin || u.pathname.includes('/lib/');
        if (!keep || await fresh.match(req)) continue;
        const res = await old.match(req);
        if (res) await fresh.put(req, res);
      }
    } catch { }
    await caches.delete(k);
  }
}

self.addEventListener('activate', (e) => {
  e.waitUntil(carryOver().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (bypassed(url.hostname)) return;

  // version.json: network-first so update checks always see the latest version
  if (url.origin === location.origin && url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match('./version.json')));
    return;
  }

  // app shell: cache-first (version bump busts it); CDN assets: cache falling back to network
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && (url.origin === location.origin || CDN_HOSTS.includes(url.hostname))) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
