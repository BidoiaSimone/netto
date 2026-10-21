/* A REAL API SERVER FOR THE TESTS, on the in-memory database.
 * The tests talk to it over HTTP exactly like the frontend does, so the routes, the validation and the
 * database triggers are all tested together. backend/server/app.js isn't used: it also starts the window
 * sessions, live reload and daily backups, which tests don't want. Only the API router is mounted.
 *
 * Port 0 lets the system pick any free port, so the tests never clash with a running `npm start`.
 */

const express = require("express");
const apiRouter = require("../../backend/server/routes/apiRouter.js");

// Starts the server. Returns { callApi, stopServer, baseUrl }.
//   callApi(method, path, body) -> { status, body }   (body already parsed from JSON)
async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use(apiRouter);

  const server = await new Promise((resolve) => {
    const startedServer = app.listen(0, "127.0.0.1", () => resolve(startedServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function callApi(method, path, body) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  // Without this the test process would keep waiting for new connections and never end
  function stopServer() {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  }

  return { callApi, stopServer, baseUrl }; // baseUrl: for answers that aren't JSON (GET /edition.js)
}

module.exports = { startTestServer };
