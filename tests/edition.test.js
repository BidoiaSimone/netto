/* FULL NETTO, NETTO LIGHT OR NETTO EXPENSES (backend/config/edition.js)
 * The page asks GET /edition.js which one it is; netto light and netto expenses keep their data apart from money.db.
 */

require("./helpers/testEnvironment.js"); // first: the in-memory database
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync } = require("child_process");
const { startTestServer } = require("./helpers/testServer.js");
const { createEditionScript } = require("../backend/config/edition.js");
const db = require("../backend/db/databaseConnection.js");
const { prepareExpensesEdition, EXPENSES_ACCOUNT_NAME, DEFAULT_EXPENSE_CATEGORIES } = require("../backend/server/services/expensesEditionSetup.js");

let server;
before(async () => { server = await startTestServer(); });
after(() => server.stopServer());

test("the script marks the page with its edition, and names the light window", () => {
  assert.equal(createEditionScript("full"), `document.documentElement.dataset.edition = "full";\n`);
  assert.match(createEditionScript("light"), /dataset\.edition = "light";/);
  assert.match(createEditionScript("light"), /document\.title = "netto light";/);
  assert.match(createEditionScript("expenses"), /dataset\.edition = "expenses";/);
  assert.match(createEditionScript("expenses"), /document\.title = "netto expenses";/);
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
  // anything that isn't "light" or "expenses" is the full app
  assert.equal(path.basename(pathsFor({ NETTO_EDITION: "lite" }).database), "money.db");
});

test("netto expenses uses expenses.db and its own backup folders", () => {
  const expenses = pathsFor({ NETTO_EDITION: "expenses" });
  assert.equal(path.basename(expenses.database), "expenses.db");
  assert.equal(path.basename(expenses.backups), "expenses-backups");
  assert.equal(path.basename(expenses.offsite), "netto expenses backups");
});

test("netto expenses gets one cash account and its categories, once, and an expense can be saved with them", async () => {
  prepareExpensesEdition(db);
  prepareExpensesEdition(db); // every start: nothing added twice

  const { body: accounts } = await server.callApi("GET", "/accounts");
  assert.deepEqual(accounts.map((account) => [account.name, account.kind]), [[EXPENSES_ACCOUNT_NAME, "cash"]]);
  const { body: categories } = await server.callApi("GET", "/categories");
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  assert.equal(expenseCategories.length, DEFAULT_EXPENSE_CATEGORIES.length);
  assert.ok(expenseCategories.every((category) => category.icon && category.color), "each has its icon and colour");

  // what Expenses.html sends, then its "Annulla"
  const spesa = expenseCategories.find((category) => category.name === "Spesa");
  const saved = await server.callApi("POST", "/transactions", { type: "expense", amount: 12.5, from_account_id: accounts[0].id, category_id: spesa.id, date: "2026-10-23" });
  assert.equal(saved.status, 201);
  assert.equal((await server.callApi("DELETE", `/transactions/${saved.body.id}`)).status, 200);

  // categories changed later are left alone: deleting one doesn't bring it back at the next start
  assert.equal((await server.callApi("DELETE", `/categories/${spesa.id}`)).status, 200);
  prepareExpensesEdition(db);
  const { body: categoriesAfterRestart } = await server.callApi("GET", "/categories");
  assert.ok(!categoriesAfterRestart.some((category) => category.name === "Spesa"));
});
