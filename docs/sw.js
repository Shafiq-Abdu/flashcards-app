const CACHE_NAME = "flashcards-pwa-v1";
const APP_SHELL = [
  "/flashcards-app/",
  "/flashcards-app/index.html",
  "/flashcards-app/style.css",
  "/flashcards-app/script.js",
  "/flashcards-app/manifest.webmanifest"
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for same-origin assets, network-first for everything else
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle our GitHub Pages origin
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML (so updates roll out)
  if (event.request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
