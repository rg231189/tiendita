// Guarda la app en el teléfono para que abra sin internet.
// Al cambiar cualquier archivo de la app, sube el número de versión.
const VERSION = 'tiendita-v1';
const FILES = ['./', 'index.html', 'app.js', 'catalogo.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'vendor/JsBarcode.all.min.js', 'vendor/html5-qrcode.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // la hoja de Google siempre va por red
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('index.html')))
  );
});
