const CACHE_NAME = 'ar-professional-v1';
const STATIC_ASSETS = ['icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(()=>{})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

/* Network-first: sempre tenta buscar a versão mais nova do site.
   Só usa algo salvo em cache se o celular estiver sem internet.
   Isso evita ficar preso numa versão antiga do catálogo. */
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
