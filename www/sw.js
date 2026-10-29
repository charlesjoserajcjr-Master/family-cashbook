// Family Cashbook offline support (web version only).
// Keeps a copy of the app itself so it opens without internet. Your ledger data is not stored here;
// it lives in the browser's storage (and in Google Drive once sync is on).
const CACHE = 'cashbook-family-v7-__BUILD__';
const CORE = ['./', 'index.html', 'config.js', 'local-store.js', 'domain.js', 'ledger-schema.js', 'sync-records.js', 'security.js', 'family-files.js', 'family-ui.js', 'currency.js','currency-ui.js', 'entitlements.js','billing-ui.js','vendor/native-plugins.js', 'planner-ui.js','companion-ui.js', 'manifest.webmanifest', 'icons/favicon-32.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cashbook-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Serve from the saved copy straight away (fast on slow ship internet), and refresh it in the
// background when online, so the next opening has the latest version.
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // never touch Google sign-in or Drive
  e.respondWith(caches.open(CACHE).then(async cache => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    // App modules belong to one installed version; refresh only by installing a new worker.
    if(cached&&CORE.some(p=>new URL(p,self.location.href).pathname===new URL(typeof key==='string'?key:key.url,self.location.href).pathname))return cached;
    const fresh = fetch(req).then(res => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || new Response('Offline and not saved yet. Open Family Cashbook once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }));
});
