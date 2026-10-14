// ---- connection to the server while this window is open ----
// Tells the server this window is open; when every window is closed the server can stop
// (see backend/server/appWindow/openWindowSessions.js).
// It also carries live reload: the page refreshes itself when you save a file (see frontendLiveReload.js).
// If the connection is closed for good (Safari can do that when a download starts), a new one is opened.

const RECONNECT_DELAY_MILLISECONDS = 1000;

let serverBootId = null; // changes when the server restarts

// Only styles changed: swap them in place, keeping everything typed on the page
function reloadStylesheets() {
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const stylesheetUrl = new URL(link.href);
    if (stylesheetUrl.origin !== location.origin) continue; // e.g. Google Fonts
    stylesheetUrl.searchParams.set("v", Date.now());
    link.href = stylesheetUrl.href;
  }
}

export function connectToServerSession() {
  const session = new EventSource("/session");
  session.addEventListener("hello", (event) => {
    if (serverBootId && event.data !== serverBootId) location.reload(); // the server restarted: backend code changed
    serverBootId = event.data;
  });
  session.addEventListener("reload", () => location.reload());
  session.addEventListener("css", reloadStylesheets);
  session.addEventListener("error", () => {
    if (session.readyState === EventSource.CLOSED) setTimeout(connectToServerSession, RECONNECT_DELAY_MILLISECONDS); // otherwise it retries by itself
  });
}
