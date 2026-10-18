// Cache only static UI; never cache authenticated API endpoints.
self.addEventListener('install', e => e.waitUntil(caches.open('pi-mobile-ui-v1').then(c => c.addAll(['/','/manifest.webmanifest','/pi-icon-192.png','/pi-icon-512.png']))));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname === '/health' || u.pathname === '/events') return;
  if (['/','/manifest.webmanifest','/pi-icon-192.png','/pi-icon-512.png'].includes(u.pathname)) e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
