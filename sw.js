// Service Worker: App-Dateien offline verfügbar halten. Die Finanzdaten selbst liegen in IndexedDB, nicht hier.
// Bei jeder Änderung an App-Dateien VERSION erhöhen.
// Unter derselben Adresse (mwenzelides-privat.github.io) liegt auch die Gesundheitsakte: dieser Service Worker liest,
// schreibt und löscht nur eigene Speicher („finanzen-…“) und nur Anfragen unter /finanzen/.
const VERSION = 'd7.27.2';
const CACHE = 'finanzen-dash-' + VERSION;
const APP = ['./', 'index.html', 'manifest.webmanifest', 'config.js', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/suche.js', 'js/quelle.js', 'js/export.js', 'js/chat.js', 'js/salden.js', 'js/steuer.js', 'js/gehalt.js', 'js/pruefen.js',
  'js/steuerprognose.js', 'js/unterhalt.js', 'js/unterhaltsrechner.js', 'js/fristen.js', 'js/waechter.js', 'js/planung.js', 'js/vermoegen.js', 'js/kredit.js', 'js/zupruefen.js', 'js/vorschau.js',
  'css/steuerprognose.css', 'css/unterhalt.css', 'css/fristen.css', 'css/waechter.css', 'css/planung.css', 'css/vermoegen.css', 'css/vorschau.css', 'css/design.css'];
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

// nur im eigenen Speicher suchen (caches.match ohne open() durchsucht alle Speicher der Adresse, auch die der Gesundheitsakte)
const eigen = (req, opt) => caches.open(CACHE).then((c) => c.match(req, opt));

// App-Dateien: erst Netz (immer aktuell), sonst Offline-Kopie. Bibliotheken: Offline-Kopie zuerst.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN.includes(req.url)) {
    e.respondWith(eigen(req).then((r) => r || fetch(req).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return res; })));
    return;
  }
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
    return res;
  }).catch(() => eigen(req, { ignoreSearch: true }).then((r) => r || eigen('index.html'))));
});
