/* THE SERVER: puts the pieces together and starts listening.
 * Each piece lives in its own file; this one only decides the order they run in.
 */

const express = require("express");
const { SERVER_PORT, SERVER_HOST, MAXIMUM_REQUEST_BODY_SIZE } = require("../config/serverSettings.js");
const { FRONTEND_DIRECTORY } = require("../config/projectPaths.js");
const { createRejectRequestsFromOtherHosts } = require("./middleware/rejectRequestsFromOtherHosts.js");
const { handleWindowSessionConnection, startExitTimerForWhenNoWindowOpens } = require("./appWindow/openWindowSessions.js");
const { startFrontendLiveReload } = require("./appWindow/frontendLiveReload.js");
const { startAutomaticDailyBackups } = require("./services/automaticDailyBackups.js");
const { startRecurringTransactionPoster } = require("./services/recurringTransactionPoster.js");
const apiRouter = require("./routes/apiRouter.js");

const app = express();
app.use(express.json({ limit: MAXIMUM_REQUEST_BODY_SIZE }));
app.set("json spaces", 2);

app.use(createRejectRequestsFromOtherHosts(SERVER_PORT)); // first: nothing below runs for a foreign Host

app.get("/session", handleWindowSessionConnection); // one connection per open app window
startFrontendLiveReload();
startExitTimerForWhenNoWindowOpens();

app.use(apiRouter);                                  // the API
app.use(express.static(FRONTEND_DIRECTORY));         // pages, css, js, images
app.get("/", (request, response) => response.redirect("/HTML/Home.html"));

app.listen(SERVER_PORT, SERVER_HOST, function onServerStarted(error) {
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`Server listening on http://localhost:${SERVER_PORT}`);
  startAutomaticDailyBackups();      // one copy of the database per day
  startRecurringTransactionPoster(); // adds the recurring transactions that are due, now and every new day
});

module.exports = app;
