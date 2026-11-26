// Offline copy of the trip. Trip-agnostic: saves the app itself, the trip data, and every file
// the trip data points at (booking documents, QR images, place photos).
// - App files: served from the saved copy at once, refreshed in the background (no version bumps needed).
// - Trip data: network first with a short timeout, saved copy when the signal is gone.
// - Documents and photos: saved copy first; new or changed files are fetched whenever the trip data changes.
// Live data (weather, exchange rate, map tiles) stays network-only; the app keeps its own last values.
// Two kinds of build:
// - open (development): data/trip.json, read here to find the files.
// - locked (published, see tools/publish.mjs): data/index.json lists the files and data/trip.enc holds the
//   encrypted trip. Everything is saved still encrypted; only the page, with the passcode, can open it.
const SHELL = 'trip-shell-v1';
const DATA = 'trip-data';
const TRIP = 'data/trip.json';
const INDEX = 'data/index.json';
const CORE = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png',
  'vendor/fonts/archivo-latin.woff2', 'vendor/fonts/archivo-latin-ext.woff2',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
];
const abs = (p) => new URL(p, self.registration.scope).href;
const filesOf = (trip) => [
  ...(trip.bookings || []).flatMap((b) => (b.files || []).flatMap((f) => [f.path, ...(f.pages || [])])),
  ...[...Object.values(trip.places || {}), ...(trip.events || [])].map((p) => p.photo && p.photo.src),
].filter(Boolean);
const listOf = (index) => [index.trip, ...(index.files || [])];

// make the saved files match what the trip references: fetch what's missing, drop what's gone
async function saveTripFiles(paths) {
  const cache = await caches.open(DATA);
  const want = new Set(paths.map(abs));
  const keep = new Set([...want, abs(TRIP), abs(INDEX)]);
  let failed = 0;
  await Promise.all([...want].map(async (u) => {
    if (await cache.match(u)) return;
    try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) await cache.put(u, r); else failed++; } catch { failed++; }
  }));
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
  return { total: want.size, failed };
}
// the current file list, straight from the network; also refreshes the saved trip data
async function freshList() {
  const cache = await caches.open(DATA);
  const i = await fetch(abs(INDEX), { cache: 'no-cache' }).catch(() => null);
  if (i && i.ok) {
    const index = await i.clone().json();
    const t = await fetch(abs(index.trip), { cache: 'no-cache' });
    if (!t.ok) throw new Error('trip ' + t.status);
    await cache.put(abs(INDEX), i);
    await cache.put(abs(index.trip), t);
    return listOf(index);
  }
  const r = await fetch(abs(TRIP), { cache: 'no-cache' });
  if (!r.ok) throw new Error('trip.json ' + r.status);
  await cache.put(abs(TRIP), r.clone());
  return filesOf(await r.json());
}
async function savedList() {
  const cache = await caches.open(DATA);
  const i = await cache.match(abs(INDEX));
  if (i) return listOf(await i.json());
  const t = await cache.match(abs(TRIP));
  return t ? filesOf(await t.json()) : null;
}

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(CORE.map(abs));
    try { await saveTripFiles(await freshList()); } catch { /* finished on the next visit with signal */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== DATA) await caches.delete(k);
    await self.clients.claim();
  })());
});

// the page asks "save everything now" (More > Offline); reply when done
self.addEventListener('message', (ev) => {
  if (ev.data !== 'save') return;
  ev.waitUntil((async () => {
    let res;
    try { res = await saveTripFiles(await freshList()); } catch {
      const saved = await savedList();
      res = saved ? { ...(await saveTripFiles(saved)), offline: true } : { total: 0, failed: 1, offline: true };
    }
    ev.source && ev.source.postMessage({ type: 'saved', ...res });
  })());
});

const timeout = (ms) => new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms));
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // weather, rates, tiles: network only

  const key = url.href.split('?')[0];
  if (key === abs(TRIP) || key === abs(INDEX) || /\/data\/trip\.enc$/.test(key)) { // network first (4 s), then the saved copy
    ev.respondWith((async () => {
      try {
        const r = await Promise.race([fetch(req), timeout(4000)]);
        if (r.ok) {
          await (await caches.open(DATA)).put(key, r.clone());
          if (key === abs(TRIP)) ev.waitUntil(r.clone().json().then((t) => saveTripFiles(filesOf(t))).catch(() => {}));
          if (key === abs(INDEX)) ev.waitUntil(r.clone().json().then((i) => saveTripFiles(listOf(i))).catch(() => {}));
          return r;
        }
        // an open build has no index (404): pass that on. Any other failure: the saved copy if there is one
        return (r.status !== 404 && await caches.match(key)) || r;
      } catch {
        return (await caches.match(key)) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.includes('/data/')) { // documents and photos: saved copy first
    ev.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) (await caches.open(DATA)).put(key, r.clone());
      return r;
    })());
    return;
  }

  // the app itself: saved copy now, refreshed in the background for next time
  ev.respondWith((async () => {
    const k = req.mode === 'navigate' ? abs('index.html') : key;
    const cache = await caches.open(SHELL);
    const hit = await cache.match(k);
    const net = fetch(req).then((r) => { if (r.ok && r.type === 'basic') cache.put(k, r.clone()); return r; });
    if (hit) { ev.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});
