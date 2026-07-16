/* TripNest Service Worker — offline-first shell so tickets open with no signal. */
const CACHE_VERSION = '1.0.0';
const CACHE_NAME = `tripnest-${CACHE_VERSION}`;

const CORE = [
  './', './index.html', './css/style.css', './manifest.json', './version.json',
  './js/db.js', './js/ui.js', './js/gemini.js', './js/google.js', './js/members.js', './js/vault.js',
  './js/documents.js', './js/itinerary.js', './js/trips.js', './js/agent.js', './js/settings.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

// hosts that must never be cached (auth, APIs)
const BYPASS = ['accounts.google.com', 'googleapis.com', 'generativelanguage.googleapis.com', 'apis.google.com', 'oauth2.googleapis.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
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

  // app shell: cache-first (version bump busts it); CDN assets: cache falling back to network
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && (url.origin === location.origin || ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com'].includes(url.hostname))) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
