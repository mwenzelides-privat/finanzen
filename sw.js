// Abschaltung: Diese Version ersetzt den alten Offline-Speicher, löscht ihn und meldet sich selbst ab.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('finanzen-')) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
self.addEventListener('fetch', () => {}); // nichts mehr abfangen
