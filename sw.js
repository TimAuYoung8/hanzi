/* Service worker: the piece that makes the app work with no signal.
   It saves a copy of every file below on first visit, then serves those
   copies instead of hitting the network. Bump CACHE when you change files,
   otherwise the phone will keep showing the old version. */

const CACHE = "hanzi-v3";

const FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./manifest.json",
  "./data/index.json",
  "./data/hsk1.json", "./data/hsk2.json", "./data/hsk3.json", "./data/hsk4.json",
  "./data/hsk5.json", "./data/hsk6.json", "./data/hsk7.json",
  "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  // addAll fails the whole install if ONE file 404s, so we add them
  // individually and tolerate misses.
  e.waitUntil(
    caches.open(CACHE)
      // cache: "reload" skips the browser's own download cache, so an update
      // can never re-save a stale copy of the old files.
      .then(c => Promise.all(FILES.map(f =>
        c.add(new Request(f, { cache: "reload" })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  // Delete caches from older versions of the app.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
