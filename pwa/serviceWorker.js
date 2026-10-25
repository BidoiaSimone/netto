/* THE PWA'S SERVICE WORKER: netto opens with no connection at all
 * Unlike frontend/serviceWorker.js (network first, for a page served by the Mac), the PWA has no server and no data
 * on the network: every file it needs is saved when this worker is installed, and every request is answered from
 * those copies. The build (pwa/build.mjs) writes the file list and a version made from their contents in place of
 * the two placeholders below, so any change to the app installs a new set of copies and drops the old one.
 * The data itself is never here: it's in the database the backend keeps (pwa/browserBackend/apiWorker.js).
 */

const VERSION = "__NETTO_VERSION__";
const APP_FILES = __NETTO_APP_FILES__; // paths relative to this file, e.g. "HTML/Home.html"
const CACHE_NAME = `netto-pwa-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES.map((file) => new URL(file, self.registration.scope)))));
  self.skipWaiting(); // the next load uses the new version
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("netto-pwa-") && name !== CACHE_NAME) await caches.delete(name);
    await self.clients.claim();
  })());
});

// The saved copy when there is one (ignoring ?v= and the like), the network otherwise (e.g. Google Fonts)
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true, cacheName: CACHE_NAME }).then((saved) => saved || fetch(event.request)));
});
