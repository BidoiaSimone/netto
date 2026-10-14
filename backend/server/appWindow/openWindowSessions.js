/* APP WINDOW TRACKING
 * Every open page keeps a connection to /session (see frontend/JS/app/serverSession.js).
 * The connection is a Server-Sent Events stream: the server can push messages to the page through it
 * (used by live reload, see frontendLiveReload.js).
 *
 * When started by the launcher (AUTO_EXIT=1), the server stops itself once no page has been open for a
 * few seconds, so closing the app window closes the app. `npm run dev` doesn't set AUTO_EXIT, so during
 * development nothing changes.
 */

const crypto = require("crypto");
const { SHOULD_EXIT_WHEN_NO_WINDOW_IS_OPEN } = require("../../config/serverSettings.js");

// A new id at every start: a page reconnecting after a restart sees a different id and reloads itself
const SERVER_BOOT_ID = crypto.randomUUID();
const KEEP_ALIVE_INTERVAL_MILLISECONDS = 20000;
const EXIT_DELAY_AFTER_LAST_WINDOW_CLOSES_MILLISECONDS = 10000; // a page reload reconnects well within that
const EXIT_DELAY_IF_NO_WINDOW_EVER_OPENS_MILLISECONDS = 60000; // e.g. the browser failed to start

const openWindowConnections = new Set(); // one Server-Sent Events response per open page
let exitTimer = null;

function scheduleExitIfNoWindowIsOpen(delayMilliseconds) {
  if (!SHOULD_EXIT_WHEN_NO_WINDOW_IS_OPEN) return;
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => {
    if (openWindowConnections.size === 0) {
      console.log("No app window open: shutting down");
      process.exit(0);
    }
  }, delayMilliseconds);
}

// GET /session: stays open as long as the page is open
function handleWindowSessionConnection(request, response) {
  response.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  response.flushHeaders();
  response.write(": open\n\n");
  // retry: reconnect quickly after a restart; hello: lets the page notice the server restarted
  response.write(`retry: 1000\nevent: hello\ndata: ${SERVER_BOOT_ID}\n\n`);
  openWindowConnections.add(response);
  clearTimeout(exitTimer);
  const keepAliveTimer = setInterval(() => response.write(": ping\n\n"), KEEP_ALIVE_INTERVAL_MILLISECONDS);
  request.on("close", () => {
    clearInterval(keepAliveTimer);
    openWindowConnections.delete(response);
    if (openWindowConnections.size === 0) scheduleExitIfNoWindowIsOpen(EXIT_DELAY_AFTER_LAST_WINDOW_CLOSES_MILLISECONDS);
  });
}

// Sends an event to every open page
function sendEventToAllOpenWindows(eventName, data) {
  for (const response of openWindowConnections) response.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function startExitTimerForWhenNoWindowOpens() {
  scheduleExitIfNoWindowIsOpen(EXIT_DELAY_IF_NO_WINDOW_EVER_OPENS_MILLISECONDS);
}

module.exports = { handleWindowSessionConnection, sendEventToAllOpenWindows, startExitTimerForWhenNoWindowOpens };
