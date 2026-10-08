// Offline support. App files are fetched fresh when online (so changes pushed to GitHub show up
// on the next load) and served from the cache when offline. The PDF reader is cache-first.
const CACHE = "ff6-guide-v3";
const APP = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/importers/index.js",
  "js/importers/text.js",
  "js/importers/html.js",
  "js/importers/markdown.js",
  "js/importers/webarchive.js",
  "js/render.js",
  "js/store.js",
  "js/extract.js",
  "js/maps.js",
  "js/zip.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];
const VENDOR = ["vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP);
    // The PDF reader is only needed for importing; don't fail install if it can't be fetched.
    await c.addAll(VENDOR).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.includes("/vendor/")) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

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
