/* LIQUIDITY (GET /net-worth, backend/server/services/netWorthCalculator.js)
 * by_liquidity splits the net worth into cash and equivalents, restricted, investments and personal-use
 * assets (config/accountKinds.js). Those parts must add up to net_worth, and each must hold exactly
 * the accounts of its kinds.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { ACCOUNT_KINDS } = require("../backend/config/accountKinds.js");
const { FAKE_CURRENT_PRICE_BY_TICKER } = require("./helpers/fakeYahooFinanceMarketData.js");
const { buildFinancialStatements } = require("../backend/server/services/financialStatements.js");
const { getTodayAsLocalDate } = require("../backend/server/utils/localDates.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

// Euros back to whole cents, so sums of euro floats can be compared exactly
const toCents = (euros) => Math.round(euros * 100);
const sumOfLiquidityClasses = (byLiquidity) => Object.values(byLiquidity).reduce((sum, euros) => sum + toCents(euros), 0);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

test("by_liquidity adds up to net_worth", async () => {
  const netWorth = await call("GET", "/net-worth");
  assert.deepEqual(Object.keys(netWorth.by_liquidity).sort(), ["cash_and_equivalents", "investments", "personal_use", "restricted"]);
  assert.equal(sumOfLiquidityClasses(netWorth.by_liquidity), toCents(netWorth.net_worth));
  assert.equal(toCents(netWorth.accounts_value) + toCents(netWorth.investments_value), toCents(netWorth.net_worth));
  assert.deepEqual(netWorth.failed_tickers, []);
});

test("each liquidity class holds exactly the accounts of its kinds, and the investments at today's prices", async () => {
  const netWorth = await call("GET", "/net-worth");
  const expectedCentsByClass = { cash_and_equivalents: 0, restricted: 0, personal_use: 0 };
  for (const account of db.prepare(`SELECT kind, balance FROM accounts`).all()) expectedCentsByClass[ACCOUNT_KINDS[account.kind].liquidity] += account.balance;
  for (const [liquidityClass, cents] of Object.entries(expectedCentsByClass)) {
    assert.equal(toCents(netWorth.by_liquidity[liquidityClass]), cents, liquidityClass);
  }
  assert.equal(toCents(netWorth.by_liquidity.restricted), db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(dataset.accountIds.mealVouchers).balance);
  assert.equal(toCents(netWorth.by_liquidity.personal_use), db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(dataset.accountIds.car).balance);

  // VWCE.MI: 10 + 5 − 4 = 11 shares, AAPL: 3 − 1 = 2 shares
  const expectedInvestments = 11 * FAKE_CURRENT_PRICE_BY_TICKER["VWCE.MI"] + 2 * FAKE_CURRENT_PRICE_BY_TICKER["AAPL"];
  assert.equal(toCents(netWorth.by_liquidity.investments), toCents(expectedInvestments));
});

test("still adds up when every account kind changes and money moves between classes", async () => {
  await call("POST", "/transactions", { type: "movement", amount: 33.33, from_account_id: dataset.accountIds.mealVouchers, to_account_id: dataset.accountIds.cash });
  await call("PUT", `/accounts/${dataset.accountIds.savings}`, { name: "Savings", kind: "restricted", opening_balance: 5000 });
  const netWorth = await call("GET", "/net-worth");
  assert.equal(sumOfLiquidityClasses(netWorth.by_liquidity), toCents(netWorth.net_worth));
  await call("PUT", `/accounts/${dataset.accountIds.savings}`, { name: "Savings", kind: "savings", opening_balance: 5000 });
});

test("a ticker without a price is reported, left out of every total, and the rest still adds up", async () => {
  // put straight into the holdings table: the API refuses tickers the market data doesn't know
  db.prepare(`INSERT INTO investments (ticker, shares, amount_invested) VALUES ('DELISTED.MI', 5, 50000)`).run();
  try {
    const netWorth = await call("GET", "/net-worth");
    assert.deepEqual(netWorth.failed_tickers, ["DELISTED.MI"]);
    assert.equal(sumOfLiquidityClasses(netWorth.by_liquidity), toCents(netWorth.net_worth));
  } finally {
    db.prepare(`DELETE FROM investments WHERE ticker = 'DELISTED.MI'`).run();
  }
});

test("today's balance sheet closes at the same net worth as /net-worth", async () => {
  const today = getTodayAsLocalDate();
  const netWorth = await call("GET", "/net-worth");
  const statements = await buildFinancialStatements(today, today);
  // the Statements round each holding's value to the cent, the net worth doesn't: one cent per ticker at most
  assert.ok(Math.abs(toCents(statements.balance_sheet.closing) - toCents(netWorth.net_worth)) <= 2,
    `balance sheet ${statements.balance_sheet.closing} vs net worth ${netWorth.net_worth}`);
});
