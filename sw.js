// Service Worker: App-Dateien offline verfügbar halten. Die Finanzdaten selbst liegen in IndexedDB, nicht hier.
// Bei jeder Änderung an App-Dateien VERSION erhöhen.
const VERSION = 'd5.3.0';
const CACHE = 'finanzen-dash-' + VERSION;
const APP = ['./', 'index.html', 'manifest.webmanifest', 'config.js', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/suche.js', 'js/quelle.js', 'js/export.js', 'js/chat.js', 'js/salden.js', 'js/steuer.js'];
const CDN = ['https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP.map((u) => new Request(u, { cache: 'reload' })));
    await Promise.all(CDN.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('finanzen-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// App-Dateien: erst Netz (immer aktuell), sonst Offline-Kopie. Bibliotheken: Offline-Kopie zuerst.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN.includes(req.url)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return res; })));
    return;
  }
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
