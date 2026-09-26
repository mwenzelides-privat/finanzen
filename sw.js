// Service Worker: macht die App offline-fähig.
// Bei jeder Änderung an App-Dateien VERSION erhöhen, dann bekommen alle Geräte das Update angeboten.
const VERSION = 'v1.0.1';
const CACHE = 'finanzen-' + VERSION;
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);
const APP = [
  './', 'index.html', 'manifest.webmanifest', 'config.js', 'css/app.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/util.js', 'js/icons.js', 'js/crypto.js', 'js/store.js', 'js/defaults.js', 'js/calc.js',
  'js/categorize.js', 'js/charts.js', 'js/ui.js', 'js/forms.js', 'js/drive.js', 'js/sync.js',
  'js/importer.js', 'js/demo.js',
  'js/views/dashboard.js', 'js/views/transactions.js', 'js/views/accounts.js', 'js/views/budgets.js',
  'js/views/vacation.js', 'js/views/tax.js', 'js/views/reports.js', 'js/views/import.js', 'js/views/settings.js',
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP.map((u) => new Request(u, { cache: 'reload' })));
    await Promise.all(CDN.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('finanzen-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google-Anmeldung und Drive-API nie cachen
  if (/googleapis\.com|accounts\.google\.com|gstatic\.com/.test(url.hostname)) return;

  if (url.origin === self.location.origin) {
    // App-Dateien: aus dem Cache (schnell & offline), Seitenaufruf fällt auf index.html zurück.
    // Lokal (Entwicklung) zuerst Netzwerk, damit Änderungen sofort sichtbar sind.
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      if (DEV) {
        try { const res = await fetch(req, { cache: 'no-store' }); if (res.ok) c.put(req, res.clone()); return res; } catch { /* offline */ }
      }
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
      if (hit) return hit;
      try { return await fetch(req); } catch { return new Response('Offline', { status: 503 }); }
    })());
    return;
  }
  if (CDN.includes(req.url)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req.url, res.clone());
      return res;
    })());
  }
});
