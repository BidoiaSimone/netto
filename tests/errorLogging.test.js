/* ERRORS DON'T COPY YOUR DATA INTO THE SERVER LOG (middleware/answerErrorsWithoutLoggingData.js)
 * A body that isn't valid JSON is quoted in the parser's error message; it must be answered, not logged.
 * A real server error is logged, but only with where it happened in the code, never its message.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { answerErrorsWithoutLoggingData } = require("../backend/server/middleware/answerErrorsWithoutLoggingData.js");

async function withServerCapturingTheLog(run) {
  const app = express();
  app.use(express.json());
  app.post("/transactions", (request, response) => response.json({ ok: true }));
  app.get("/broken", () => { throw new Error("Rent 1200 for Via Roma"); });
  app.use(answerErrorsWithoutLoggingData);
  const server = await new Promise((resolve) => { const started = app.listen(0, "127.0.0.1", () => resolve(started)); });
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...parts) => logged.push(parts.join(" "));
  try {
    await run(`http://127.0.0.1:${server.address().port}`, logged);
  } finally {
    console.error = originalConsoleError;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("a body that isn't valid JSON gets a 400 and nothing in the log", async () => {
  await withServerCapturingTheLog(async (baseUrl, logged) => {
    const response = await fetch(`${baseUrl}/transactions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "Rent 1200 for Via Roma",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid request" });
    assert.deepEqual(logged, []);
  });
});

test("a server error gets a 500 and its message stays out of the log", async () => {
  await withServerCapturingTheLog(async (baseUrl, logged) => {
    const response = await fetch(`${baseUrl}/broken`);
    assert.equal(response.status, 500);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^Error on GET \/broken/);
    assert.doesNotMatch(logged[0], /Rent|1200|Via Roma/);
  });
});
