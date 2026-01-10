const CACHE_VERSION = "v4"; // <-- bump this every time you deploy UI changes
const CACHE_NAME = `flashcards-pwa-${CACHE_VERSION}`;

const APP_SHELL = [
  "/flashcards-app/",
  "/flashcards-app/index.html",
  "/flashcards-app/style.css",
  "/flashcards-app/script.js",
  "/flashcards-app/manifest.webmanifest",
  "/flashcards-app/icons/icon-192.png",
  "/flashcards-app/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();

  // Tell all open tabs/apps: "a new version is active"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }));
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML so new deployments show up
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
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
