const CACHE = "wardrobe-v1";
const STATIC = ["/", "/index.html", "/style.css", "/app.js", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Always network-first for Firebase and API calls
  if (url.host.includes("firebase") || url.host.includes("googleapis") || url.pathname.startsWith("/api")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
