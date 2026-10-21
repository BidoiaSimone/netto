/* THE SERVICE WORKER: lets netto open, and keep showing your data, when the server can't be reached
 * (the phone away from a sleeping Mac). Registered by JS/main.js; the browser runs it beside the page and
 * every request of the page goes through it.
 *
 * Network first, the saved copy as a fallback:
 *   every GET (the page, its CSS / JS / images, and the API's answers) goes to the server as usual; each good
 *   answer is also saved in this browser. When the server doesn't answer within a few seconds, the saved copy is
 *   used instead, marked with an X-Netto-Saved-At header (when it was saved) so the page can say it's showing
 *   older data (JS/app/offlineStatus.js).
 *   Slow is not gone: together with each request, /ping (a tiny request the server answers at once) asks "are you
 *   there?". If /ping answers, the server is there and the real answer is waited for, however long it takes (the net
 *   worth waits on Yahoo's prices); if /ping gets nothing within PING_TIMEOUT, the server is taken as unreachable
 *   and the saved copy is used right away. A sleeping Mac doesn't refuse, it just never answers: this is what keeps
 *   the wait for it down to those few seconds.
 *   After that, the next STRAIGHT_TO_SAVED_COPY seconds go straight to the saved copies, so the page doesn't wait on
 *   every request. Every page load (and "Try again") tells this worker to forget that and ask the server again
 *   ("server-may-be-back" message, sent by JS/core/connectionState.js): a reload always really tries the Mac.
 * Because the server is always asked first, a new version of netto is picked up as soon as it can be reached:
 * the saved copies are never older than the last time it answered.
 *
 * Changes (POST, PUT, DELETE) are never touched here: a new transaction made while offline is kept by the page
 * itself (JS/core/offlineQueue.js) and sent once the server is back.
 * Note: the saved copies hold your data (balances, transactions) in this browser's storage on this device.
 */

const CACHE_NAME = "netto";
const PING_TIMEOUT_MILLISECONDS = 3000;
const STRAIGHT_TO_SAVED_COPY_MILLISECONDS = 15000;
const NEVER_SAVED = ["/session", "/database", "/ping"]; // the live connection, the debug dump, the "are you there?"
const UNREACHABLE = Symbol("unreachable");
const never = new Promise(() => {});
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

let serverUnreachableUntil = 0;

self.addEventListener("install", () => self.skipWaiting());                                // a new version takes over at once
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A page (re)loaded, or "Try again": ask the server again from now on, whatever failed before
self.addEventListener("message", (event) => {
  if (event.data === "server-may-be-back") serverUnreachableUntil = 0;
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // changes go straight to the server
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || NEVER_SAVED.some((path) => url.pathname.startsWith(path))) return;
  if (url.pathname === "/" && request.mode === "navigate") {
    event.respondWith(Response.redirect("/HTML/Home.html", 302)); // the server would answer the same, but needs to be reachable
    return;
  }
  event.respondWith(answerFromNetworkOrSavedCopy(request));
});

// Is the server there at all? One /ping at a time, shared by every request that's waiting
let pingInFlight = null;
function isServerAnswering() {
  pingInFlight ??= Promise.race([
    fetch("/ping", { cache: "no-store" }).then((response) => response.ok, () => false),
    sleep(PING_TIMEOUT_MILLISECONDS).then(() => false),
  ]).finally(() => { setTimeout(() => { pingInFlight = null; }, 2000); });
  return pingInFlight;
}

async function answerFromNetworkOrSavedCopy(request) {
  const cache = await caches.open(CACHE_NAME);
  if (Date.now() >= serverUnreachableUntil) {
    const networkAnswer = fetch(request).catch(() => null); // null: the network failed outright
    const serverGone = isServerAnswering().then((isThere) => (isThere ? never : UNREACHABLE)); // there: wait for the answer
    let response = await Promise.race([networkAnswer, serverGone]);
    if (response === UNREACHABLE) response = null;
    if (response) {
      if (response.ok && !response.redirected) await saveCopy(cache, request, response.clone());
      return response;
    }
    serverUnreachableUntil = Date.now() + STRAIGHT_TO_SAVED_COPY_MILLISECONDS;
  }
  const savedCopy = await cache.match(request, { ignoreSearch: false });
  if (savedCopy) return savedCopy;
  const isApiCall = !request.url.includes("/HTML/") && !/\.(css|js|png|svg|ico|woff2|webmanifest|jpg)$/.test(new URL(request.url).pathname);
  return isApiCall
    ? new Response(JSON.stringify({ error: "Can't reach netto's server, and nothing was saved for this yet." }),
        { status: 503, headers: { "Content-Type": "application/json", "X-Netto-Unreachable": "1" } })
    : Response.error();
}

// The copy is stamped with when it was saved: the page shows it when it gets the copy instead of a fresh answer
async function saveCopy(cache, request, response) {
  const headers = new Headers(response.headers);
  headers.set("X-Netto-Saved-At", new Date().toISOString());
  const body = await response.blob();
  await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));
}
