/* TripNest Service Worker — offline-first shell so tickets open with no signal. */
const CACHE_VERSION = '1.37.0';
const CACHE_NAME = `tripnest-${CACHE_VERSION}`;

const CORE = [
  './', './index.html', './css/style.css', './manifest.json', './version.json',
  './js/db.js', './js/ui.js', './js/gemini.js', './js/mrz.js', './js/google.js', './js/archive.js', './js/members.js', './js/vault.js',
  './js/documents.js', './js/food.js', './js/itinerary.js', './js/trips.js', './js/agent.js', './js/settings.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

// hosts that must never be cached (bridge, APIs)
const BYPASS = ['script.google.com', 'script.googleusercontent.com', 'googleapis.com', 'generativelanguage.googleapis.com'];

self.addEventListener('install', (e) => {
  // cache:'no-cache' — fill the new cache from the server, never from a
  // possibly-stale HTTP cache (Safari serves Pages' max-age=600 copies)
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => Promise.all(CORE.map(u =>
        fetch(u, { cache: 'no-cache' }).then(r => { if (r.ok) return c.put(u, r); })
      )))
      .then(() => self.skipWaiting())
  );
});

// the app's update banner asks the new SW to take over immediately
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (BYPASS.some(h => url.hostname.endsWith(h))) return;

  // version.json: network-first so update checks always see the latest version
  if (url.origin === location.origin && url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match('./version.json')));
    return;
  }

  // app shell: cache-first (version bump busts it); CDN assets: cache falling back to network
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && (url.origin === location.origin || ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'].includes(url.hostname))) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
