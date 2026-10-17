// Offline support. App files are fetched fresh when online (so changes pushed to GitHub show up
// on the next load) and served from the cache when offline.
const CACHE = "ff6-guide-v19";
// Monster pictures from the Final Fantasy Wiki, kept across app updates.
const IMG = "ff6-guide-img";
const IMG_HOST = "static.wikia.nocookie.net";
const APP = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/render.js",
  "js/store.js",
  "js/names.js",
  "js/backup.js",
  "js/tags.js",
  "js/rages.js",
  "js/rages-data.js",
  "js/gear.js",
  "js/gear-data.js",
  "js/monsters.js",
  "js/monsters-data.js",
  "js/party.js",
  "js/party-data.js",
  "js/optimizer.js",
  "js/espers-data.js",
  "js/cloud.js",
  "js/walkthrough.js",
  "js/wiki.js",
  "js/wiki-data.js",
  "js/worldmap.js",
  "js/worldmap-data.js",
  "walkthrough/ff6-pr.md",
  "js/zip.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== IMG) await caches.delete(k);
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === "GET" && url.hostname === IMG_HOST) {
    e.respondWith((async () => {
      const c = await caches.open(IMG);
      const hit = await c.match(req, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const res = await Promise.race([fetch(req, { cache: "no-cache" }), timeout(4000)]);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
      return Response.error();
    }
  })());
});
