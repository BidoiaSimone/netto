// ---- can the server be reached right now? ----
// Every API answer says so (core/apiClient.js): a fresh answer = yes; a failed request, or a copy saved earlier
// by the service worker (serviceWorker.js) = no. Whoever wants to know listens for "netto:connection" on window
// (JS/app/offlineStatus.js shows a line at the top of the page).

const connection = { reachable: true, oldestSavedCopy: null }; // oldestSavedCopy: ISO time, while not reachable

export const isServerReachable = () => connection.reachable;
export const getOldestSavedCopyTime = () => connection.oldestSavedCopy;

export function noteAnswerFromServer({ reachable, savedAt = null }) {
  const wasReachable = connection.reachable;
  if (reachable) {
    connection.reachable = true;
    connection.oldestSavedCopy = null;
  } else {
    connection.reachable = false;
    if (savedAt && (!connection.oldestSavedCopy || savedAt < connection.oldestSavedCopy)) connection.oldestSavedCopy = savedAt;
  }
  if (wasReachable !== connection.reachable || !reachable) window.dispatchEvent(new CustomEvent("netto:connection"));
}

// Tells the service worker (serviceWorker.js) to ask the server again for the next requests, even if it gave up on
// it a moment ago. Sent on every page load, by "Try again" and by the regular check while offline.
export function askServiceWorkerToRetry() {
  try { navigator.serviceWorker?.controller?.postMessage("server-may-be-back"); } catch {}
}
