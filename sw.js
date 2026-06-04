const CACHE = 'anwesenheit-v3';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/theme.css',
  '/js/utils.js',
  '/js/firebase-init.js',
  '/js/auth.js',
  '/js/rate-limit.js',
  '/icon.png',
  '/manifest.json'
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

// Nachricht vom App-Code empfangen (z.B. "Icon-URL hat sich geändert")
self.addEventListener('message', e => {
  if (e.data?.type === 'CACHE_ICON') {
    const iconUrl = e.data.url;
    if (!iconUrl) return;
    caches.open(CACHE).then(cache => {
      fetch(iconUrl, { mode: 'no-cors' })
        .then(res => cache.put(iconUrl, res))
        .catch(() => {});
    });
  }
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Firebase & externe Anfragen — nie cachen (außer Icon das wir explizit gecached haben)
  if (
    url.includes('firestore') ||
    url.includes('googleapis') ||
    url.includes('gstatic') ||
    url.includes('firebase') ||
    url.includes('cdnjs')
  ) return;

  // Externe URLs die nicht vom eigenen Origin kommen — nur aus Cache bedienen falls vorhanden
  if (!url.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request, { mode: 'no-cors' }))
    );
    return;
  }

  // Navigation → Network first, Fallback index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Statische eigene Assets: Cache first, dann Netz
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request))
  );
});
