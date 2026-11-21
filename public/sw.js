// Caches the app shell (Homey Home and the HomeyDeck page) so it opens instantly and works as an installed
// app. API calls always go to the network. Bump VERSION when shell files change.
const VERSION = "homeyhome-3";
const SHELL = ["/", "/app.css", "/app.js", "/manifest.webmanifest", "/icon-192.png", "/apple-touch-icon.png", "/favicon.png", "/deck/", "/deck/app.css", "/deck/app.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first, so a new deploy shows up right away; the cache is the
// fallback when the network is down.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match(url.pathname.startsWith("/deck") ? "/deck/" : "/"))),
  );
});
