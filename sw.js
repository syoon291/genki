// Offline support: the app shell is cached on install, then every same-origin
// GET is served network first (fresh code when online), cache when offline.
const CACHE = "genki-v5";
const SHELL = ["./", "index.html", "styles.css", "app.js", "db.js", "backup.js", "sync.js", "sync-view.js", "merge.js", "ui.js", "nutrition.js", "foods.js", "nutrition-view.js", "weight.js", "weight-view.js", "mfp.js", "workouts.js", "workouts-view.js", "foods/jp.json", "foods/us.json", "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only this site's files: GitHub API calls (sync) always go to the network.
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: revalidate with the server, so Pages' max-age never serves stale code.
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.status === 200) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
