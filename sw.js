// EdgeJournal service worker: offline app shell + Android "Share to EdgeJournal" inbox.
const VERSION = '202610122227';
const SHELL = `ej-shell-${VERSION}`;
const INBOX = 'ej-share-inbox';
const FILES = ['./', './index.html', './assets/app.js', './assets/app.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ej-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase / AI calls

  // Android share sheet -> save files, then open the app on the share screen
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await req.formData();
      const cache = await caches.open(INBOX);
      let i = 0;
      for (const f of form.getAll('files')) {
        if (!(f instanceof File)) continue;
        const key = `./shared/${Date.now()}-${i++}`;
        await cache.put(key, new Response(f, { headers: { 'content-type': f.type, 'x-name': encodeURIComponent(f.name) } }));
      }
      return Response.redirect('./#/share', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => r).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
