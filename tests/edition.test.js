/* FULL NETTO OR NETTO LIGHT (backend/config/edition.js)
 * The page asks GET /edition.js which one it is; netto light keeps its data apart from money.db.
 */

require("./helpers/testEnvironment.js"); // first: the in-memory database
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync } = require("child_process");
const { startTestServer } = require("./helpers/testServer.js");
const { createEditionScript } = require("../backend/config/edition.js");

let server;
before(async () => { server = await startTestServer(); });
after(() => server.stopServer());

test("the script marks the page with its edition, and names the light window", () => {
  assert.equal(createEditionScript("full"), `document.documentElement.dataset.edition = "full";\n`);
  assert.match(createEditionScript("light"), /dataset\.edition = "light";/);
  assert.match(createEditionScript("light"), /document\.title = "netto light";/);
});

test("without NETTO_EDITION the server is the full app", async () => {
  const response = await fetch(`${server.baseUrl}/edition.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.equal(await response.text(), `document.documentElement.dataset.edition = "full";\n`);
});

// Which files each edition would use, read in a separate Node process (the paths are decided once, when loaded)
function pathsFor(environment) {
  const script = `const p = require(${JSON.stringify(path.join(__dirname, "../backend/config/projectPaths.js"))});
    console.log(JSON.stringify({ database: p.DATABASE_FILE, backups: p.BACKUPS_DIRECTORY, offsite: p.OFFSITE_BACKUPS_DIRECTORY }));`;
  const cleanEnvironment = { PATH: process.env.PATH, HOME: process.env.HOME, ...environment };
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { env: cleanEnvironment }).toString());
}

test("netto light uses light.db and its own backup folders; the full app keeps money.db", () => {
  const full = pathsFor({});
  assert.equal(path.basename(full.database), "money.db");
  assert.equal(path.basename(full.backups), "backups");
  assert.equal(path.basename(full.offsite), "netto backups");

  const light = pathsFor({ NETTO_EDITION: "light" });
  assert.equal(path.basename(light.database), "light.db");
  assert.equal(path.basename(light.backups), "light-backups");
  assert.equal(path.basename(light.offsite), "netto light backups");
  assert.equal(path.dirname(light.database), path.dirname(full.database), "both in backend/db");

  // an explicit file still wins (the tests rely on it)
  assert.equal(pathsFor({ NETTO_EDITION: "light", NETTO_DATABASE_FILE: ":memory:" }).database, ":memory:");
  // anything that isn't "light" is the full app
  assert.equal(path.basename(pathsFor({ NETTO_EDITION: "lite" }).database), "money.db");
});
