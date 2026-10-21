/* THE TEST ENVIRONMENT: require this FIRST in every test file, before anything from backend/.
 *
 * backend/db/databaseConnection.js opens the database the moment it is first required, and every
 * route and service requires it. So the only safe moment to say "use another database" is before
 * that first require, which is what this file does when it is loaded:
 *
 *   1. NETTO_DATABASE_FILE = ":memory:"   a database that lives only in RAM: it starts empty, the
 *                                         migrations build it, and it vanishes when the test file ends.
 *                                         Your real money.db is never opened.
 *   2. NETTO_BACKUPS_DIRECTORY            a temporary folder, so no test can write into backend/db/backups.
 *      NETTO_OFFSITE_BACKUPS_DIRECTORY    another one inside it, so no test copies anything to your iCloud Drive.
 *   3. the Yahoo Finance module           is replaced by fakeYahooFinanceMarketData.js (fixed prices, no
 *                                         internet), so the results never depend on the market or the network.
 *
 * `node --test` runs each test file in its own process, so every file gets its own fresh database.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const TEMPORARY_BACKUPS_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), "netto-test-backups-"));
process.env.NETTO_DATABASE_FILE = ":memory:";
process.env.NETTO_BACKUPS_DIRECTORY = TEMPORARY_BACKUPS_DIRECTORY;
process.env.NETTO_OFFSITE_BACKUPS_DIRECTORY = path.join(TEMPORARY_BACKUPS_DIRECTORY, "offsite", "netto backups");

// Node keeps every module it has loaded in require.cache, keyed by its full path, and hands that copy to
// anyone who requires the same path later. Putting the fake there under the REAL file's path means every
// `require("./yahooFinanceMarketData.js")` in the backend gets the fake, without changing any backend file.
function replaceYahooFinanceWithFakePrices() {
  const realModulePath = require.resolve("../../backend/server/services/yahooFinanceMarketData.js");
  const fakeModule = new Module(realModulePath, module);
  fakeModule.filename = realModulePath;
  fakeModule.loaded = true;
  fakeModule.exports = require("./fakeYahooFinanceMarketData.js");
  require.cache[realModulePath] = fakeModule;
}
replaceYahooFinanceWithFakePrices();

// The shared connection every route uses, after checking it really is the in-memory one: if the
// environment variable were ever ignored, this stops the tests before they touch anything.
// The migrations print "Database upgraded to version N" for each version: useful in the app, noise here.
function openTestDatabase() {
  const originalLog = console.log;
  console.log = () => {};
  let db;
  try {
    db = require("../../backend/db/databaseConnection.js");
  } finally {
    console.log = originalLog;
  }
  if (db.name !== ":memory:") {
    throw new Error(`The tests opened ${db.name} instead of an in-memory database: stopping before touching it.`);
  }
  return db;
}

module.exports = { openTestDatabase, TEMPORARY_BACKUPS_DIRECTORY };
