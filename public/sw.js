/* Juniper trip PWA — network-first shell, SWR static, cache-first OSM tiles. */
const VERSION = "juniper-sw-v1";
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const TILES = `${VERSION}-tiles`;

const PRECACHE = ["/", "/favicon.svg", "/__grok/icon-180.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res.ok) await cache.put(url, res);
          } catch {
            /* first visit may be offline */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function skip(url) {
  const p = url.pathname;
  if (p.startsWith("/@") || p.startsWith("/src/") || p.startsWith("/node_modules/")) return true;
  if (p.includes("vite") || p.startsWith("/__vite") || p.startsWith("/@fs")) return true;
  if (p.startsWith("/auth/") || p.startsWith("/api/tesla")) return true;
  if (p.startsWith("/api/drive")) return true;
  return false;
}

function isApiGet(url) {
  return (
    url.pathname.startsWith("/api/elpris") ||
    url.pathname.startsWith("/api/chargers") ||
    url.pathname.startsWith("/api/charge-prices")
  );
}

function isStatic(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return (
    p.startsWith("/assets/") ||
    p.startsWith("/vehicles/") ||
    p.startsWith("/__grok/") ||
    /\.(?:js|css|woff2|svg|png|jpg|webp|ico)$/.test(p)
  );
}

function isTile(url) {
  return url.hostname === "tile.openstreetmap.org";
}

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) await cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (request.mode === "navigate") {
      const home = await cache.match("/");
      if (home) return home;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName, max = 60) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const pending = fetch(request)
    .then(async (res) => {
      if (res && res.ok) {
        await cache.put(request, res.clone());
        await trim(cache, max);
      }
      return res;
    })
    .catch(() => hit);
  return hit || pending;
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    await cache.put(request, res.clone());
    await trim(cache, max);
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (skip(url)) return;

  if (isTile(url)) {
    event.respondWith(cacheFirst(request, TILES, 80));
    return;
  }
  if (isApiGet(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME, 24));
    return;
  }
  if (isStatic(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME, 80));
    return;
  }
  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, SHELL));
  }
});
