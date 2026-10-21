/* THE SERVER: puts the pieces together and starts listening.
 * Each piece lives in its own file; this one only decides the order they run in.
 */

const path = require("path");
const express = require("express");
const { SERVER_PORT, SERVER_HOST, MAXIMUM_REQUEST_BODY_SIZE } = require("../config/serverSettings.js");
const { FRONTEND_DIRECTORY, DATABASE_FILE } = require("../config/projectPaths.js");
const { IS_LIGHT_EDITION } = require("../config/edition.js");
const { createRejectRequestsFromOtherHosts } = require("./middleware/rejectRequestsFromOtherHosts.js");
const { handleWindowSessionConnection, startExitTimerForWhenNoWindowOpens } = require("./appWindow/openWindowSessions.js");
const { startFrontendLiveReload } = require("./appWindow/frontendLiveReload.js");
const { startAutomaticDailyBackups } = require("./services/automaticDailyBackups.js");
const { startRecurringTransactionPoster } = require("./services/recurringTransactionPoster.js");
const { keepMacAwakeWhileRunning } = require("./appWindow/keepMacAwake.js");
const apiRouter = require("./routes/apiRouter.js");

const app = express();
app.use(express.json({ limit: MAXIMUM_REQUEST_BODY_SIZE }));
app.set("json spaces", 2);

app.use(createRejectRequestsFromOtherHosts(SERVER_PORT)); // first: nothing below runs for a foreign Host

app.get("/session", handleWindowSessionConnection); // one connection per open app window
// "are you there?": answered at once, no database, no Yahoo. The phone's service worker asks it when an answer is
// slow, to tell a slow server from an unreachable one (frontend/serviceWorker.js)
app.get("/ping", (request, response) => response.set("Cache-Control", "no-store").json({ ok: true }));
startFrontendLiveReload();
startExitTimerForWhenNoWindowOpens();

app.use(apiRouter);                                  // the API
// pages, css, js, images. "no-cache" doesn't mean "don't keep a copy": it means "ask before using it". Without it
// Safari may reuse a saved Home.html for a while after an update while loading the NEW scripts, and the new code
// then looks for parts of the page the old copy doesn't have ("null is not an object"). Asking costs almost nothing:
// an unchanged file is answered with a tiny "304 Not Modified" and the saved copy is used.
app.use(express.static(FRONTEND_DIRECTORY, {
  setHeaders: (response) => response.setHeader("Cache-Control", "no-cache"),
}));
app.get("/", (request, response) => response.redirect("/HTML/Home.html"));

app.listen(SERVER_PORT, SERVER_HOST, function onServerStarted(error) {
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`${IS_LIGHT_EDITION ? "netto light" : "netto"} listening on http://localhost:${SERVER_PORT} (data: ${path.basename(DATABASE_FILE)})`);
  startAutomaticDailyBackups();      // one copy of the database per day
  startRecurringTransactionPoster(); // adds the recurring transactions that are due, now and every new day
  keepMacAwakeWhileRunning();        // so the phone can reach it: appWindow/keepMacAwake.js
});

module.exports = app;
