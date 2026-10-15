/* HOME PAGE GROUPS (frontend/JS/core/netWorthGroups.js)
 * The Home page shows the net worth as three groups: liquid (cash and equivalents + restricted vouchers),
 * investments and immobilized (personal-use assets like the car). They must add up to the net worth,
 * the car must be only in "immobilized", and the bar under the cards must fill exactly 100%.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");

const db = openTestDatabase();
let callApi, stopServer, dataset, netWorthGroups;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const toCents = (euros) => Math.round(euros * 100);
const balanceInCentsOf = (accountId) => db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(accountId).balance;

before(async () => {
  // The frontend file is an ES module (export ...), but this project's package.json says "commonjs", so Node
  // refuses to import it by path. It has no imports of its own, so its source is loaded as a module directly.
  const source = fs.readFileSync(path.join(__dirname, "../frontend/JS/core/netWorthGroups.js"), "utf8");
  netWorthGroups = await import("data:text/javascript," + encodeURIComponent(source));
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

test("liquid + investments + immobilized = net worth, with the real /net-worth answer", async () => {
  const groups = netWorthGroups.splitNetWorthIntoGroups(await call("GET", "/net-worth"));
  assert.equal(toCents(groups.liquid) + toCents(groups.investments) + toCents(groups.immobilized), toCents(groups.netWorth));
});

test("the car is only in immobilized, the vouchers are in liquid and named apart", async () => {
  const netWorth = await call("GET", "/net-worth");
  const groups = netWorthGroups.splitNetWorthIntoGroups(netWorth);
  assert.equal(toCents(groups.immobilized), balanceInCentsOf(dataset.accountIds.car));
  assert.equal(toCents(groups.restrictedPartOfLiquid), balanceInCentsOf(dataset.accountIds.mealVouchers));
  assert.equal(toCents(groups.liquid), toCents(netWorth.by_liquidity.cash_and_equivalents) + toCents(netWorth.by_liquidity.restricted));
  assert.equal(toCents(groups.investments), toCents(netWorth.investments_value));
});

test("the bar fills 100%, a negative group takes no space, an empty net worth draws nothing", () => {
  const { calculateBarWidths } = netWorthGroups;
  assert.deepEqual(calculateBarWidths({ liquid: 1000, investments: 3000, immobilized: 6000 }), { liquid: 10, investments: 30, immobilized: 60 });
  assert.deepEqual(calculateBarWidths({ liquid: -500, investments: 1000, immobilized: 3000 }), { liquid: 0, investments: 25, immobilized: 75 });
  assert.deepEqual(calculateBarWidths({ liquid: 0, investments: 0, immobilized: 0 }), { liquid: 0, investments: 0, immobilized: 0 });
});
