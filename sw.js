const CACHE = 'anwesenheit-v1';
const PRECACHE = [
  '/',
  '/css/theme.css',
  '/js/utils.js',
  '/js/firebase-init.js',
  '/js/auth.js',
  '/js/rate-limit.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Firebase & externe Anfragen immer direkt übers Netz — nie cachen
  if (
    e.request.url.includes('firestore') ||
    e.request.url.includes('googleapis') ||
    e.request.url.includes('gstatic') ||
    e.request.url.includes('firebase') ||
    e.request.url.includes('cdnjs') ||
    !e.request.url.startsWith(self.location.origin)
  ) return;

  // Statische eigene Assets: Cache first, dann Netz
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request))
  );
});
