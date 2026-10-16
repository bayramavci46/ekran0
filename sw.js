/*
 * Lets Kurgu Masası open without internet once it has been opened online, and makes the site
 * installable as an app ("Ana Ekrana Ekle" on iPhone and iPad, "Uygulamayı yükle" on Android and
 * in Chrome/Edge). js/offline.js registers it where the site is served over https.
 *
 * Every file the pages use is kept as it arrives. Online, the newest version is asked for first
 * (so updates show up right away); if the network is slow or gone, the kept copy is used.
 * Videos you open are never sent here: they stay blob: addresses inside the page.
 */
const CACHE = 'kurgu-masasi-v1';
const START = ['./', 'index.html', 'editor.html', 'manifest.webmanifest'];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const PATIENCE = 4000; // ms to wait for the network before using the kept copy

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(START)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function fromNetwork(request, cache) {
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function own(request) {
  const cache = await caches.open(CACHE);
  const network = fromNetwork(request, cache);
  network.catch(() => {}); // a failure is handled below; this only keeps it from being reported twice
  const kept = await cache.match(request, { ignoreSearch: true });
  if (!kept) return network;
  // Network first, but not for long when a copy is at hand.
  const late = new Promise((resolve) => setTimeout(() => resolve(kept), PATIENCE));
  try {
    return await Promise.race([network, late]);
  } catch (err) {
    return kept;
  }
}

async function font(request) {
  // Fonts never change; the kept copy is enough.
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(own(request));
  else if (FONTS.test(request.url)) event.respondWith(font(request));
});
