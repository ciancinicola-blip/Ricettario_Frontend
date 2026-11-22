/* ==========================================================================
   SERVICE WORKER — Cianci's Menù
   Strategia: Cache-first per assets statici, Network-first per recipes.json
   ========================================================================== */

const CACHE_NAME = 'cianciMenu-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './recipes-data.js',
  './recipes.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap'
];

// Installazione: pre-cache degli asset statici
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http') || url.includes('cdn') || url.includes('cdnjs') || url.includes('fonts'))))
      .then(() => self.skipWaiting())
  );
});

// Attivazione: rimozione cache vecchie
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache-first per assets, Network-first per recipes.json
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first per recipes.json (dati aggiornabili)
  if (url.pathname.endsWith('recipes.json')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first per tutto il resto
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }))
      .catch(() => caches.match('./index.html'))
  );
});
