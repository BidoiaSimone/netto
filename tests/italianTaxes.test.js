/* ITALIAN TAX ESTIMATES (config/italianTaxRates.js, services/italianTaxEstimates.js)
 * Deferred tax on unrealized gains (no offsetting between ETFs), stamp duty on securities and on current accounts
 * (prorated by days, the 5,000 € average-balance threshold), capital gains tax on the period's sells, and the rule
 * that matters most: the estimates sit next to the statements, so the bridge still adds up to the cent.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { ITALIAN_TAX_RATES } = require("../backend/config/italianTaxRates.js");
const { buildFinancialStatements } = require("../backend/server/services/financialStatements.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const toCents = (euros) => Math.round(euros * 100);

// A current account of its own, opened (backdated) on `openDate`, so the threshold tests know every balance
async function addCurrentAccount(name, openingBalance, openDate) {
  const { id } = await call("POST", "/accounts", { name, kind: "bank", opening_balance: openingBalance });
  db.prepare(`UPDATE accounts SET open_date = ? WHERE id = ?`).run(openDate, id);
  return id;
}

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

test("the rates are the 2026 ones, with their sources dated", () => {
  assert.equal(ITALIAN_TAX_RATES.capitalGainsTaxRate, 0.26);
  assert.equal(ITALIAN_TAX_RATES.stampDutyOnSecuritiesYearlyRate, 0.002);
  assert.equal(ITALIAN_TAX_RATES.stampDutyOnCurrentAccountsYearlyAmountInCents, 3420);
  assert.equal(ITALIAN_TAX_RATES.stampDutyOnCurrentAccountsThresholdInCents, 500000);
  assert.match(ITALIAN_TAX_RATES.lastChecked, /^\d{4}-\d{2}-\d{2}$/);
});

test("deferred tax: 26% of each holding's own gain; a loss on one ETF doesn't reduce the tax on another", async () => {
  // AAPL bought again far above its (fake) market price: AAPL is now at a loss, VWCE.MI still at a gain
  await call("POST", "/investments/trades", { ticker: "AAPL", side: "buy", shares: 2, price: 300, date: "2026-04-01" });
  const statements = await buildFinancialStatements("2026-01-01", "2026-06-30");
  const holdings = statements.tax_estimates.balance_sheet.holdings;
  const vwce = holdings.find((holding) => holding.ticker === "VWCE.MI"), aapl = holdings.find((holding) => holding.ticker === "AAPL");
  assert.ok(vwce.unrealized_gain > 0 && aapl.unrealized_gain < 0, "one gain, one loss");
  assert.equal(toCents(vwce.tax), Math.round(toCents(vwce.unrealized_gain) * 0.26));
  assert.equal(aapl.tax, 0, "no tax on a loss");
  assert.equal(statements.tax_estimates.balance_sheet.deferred_tax_closing, vwce.tax, "the loss doesn't offset the gain");
  assert.ok(statements.tax_estimates.balance_sheet.deferred_tax_closing > 0.26 * (vwce.unrealized_gain + aapl.unrealized_gain), "more than 26% of the net gain");

  // the value used is the balance sheet's; the cost is the average cost of the shares held that day
  const balanceSheetVwce = statements.balance_sheet.classes.find((liquidityClass) => liquidityClass.key === "investments").items.find((item) => item.name === "VWCE.MI");
  assert.equal(vwce.value, balanceSheetVwce.closing);
  const vwceCostOnJune30 = db.prepare(`SELECT amount_invested FROM investments WHERE ticker = 'VWCE.MI'`).get().amount_invested; // no VWCE trade after March
  assert.equal(toCents(vwce.cost), vwceCostOnJune30);
});

test("net worth after tax = net worth − deferred tax, at both ends of the period", async () => {
  const statements = await buildFinancialStatements("2025-06-01", "2026-06-30");
  const { balance_sheet: afterTax } = statements.tax_estimates;
  assert.equal(toCents(afterTax.net_worth_after_tax_closing), toCents(statements.balance_sheet.closing) - toCents(afterTax.deferred_tax_closing));
  assert.equal(toCents(afterTax.net_worth_after_tax_opening), toCents(statements.balance_sheet.opening) - toCents(afterTax.deferred_tax_opening));
});

test("stamp duty on securities: 0.2% a year of the value at the end of the period, prorated by days", async () => {
  // 1 Jan – 31 Mar 2026 = 90 days: value × 0.002 × 90 / 365
  const statements = await buildFinancialStatements("2026-01-01", "2026-03-31");
  const { period } = statements.tax_estimates;
  assert.equal(statements.tax_estimates.days, 90);
  assert.equal(period.securities_value_at_end, statements.investment_returns.total.closing);
  assert.equal(toCents(period.stamp_duty_on_securities), Math.round(toCents(period.securities_value_at_end) * 0.002 * 90 / 365));
  // a whole year: the full 0.2%
  const wholeYear = await buildFinancialStatements("2025-01-01", "2025-12-31");
  assert.equal(toCents(wholeYear.tax_estimates.period.stamp_duty_on_securities), Math.round(toCents(wholeYear.tax_estimates.period.securities_value_at_end) * 0.002));
});

test("stamp duty on current accounts: 34.20 € a year, only above an average of 5,000 €, prorated", async () => {
  await addCurrentAccount("Just over", 5000.01, "2024-01-01");
  await addCurrentAccount("Exactly 5000", 5000, "2024-01-01");
  // 4,000 € until 5 Mar, 7,000 € from 6 Mar: over 1–10 Mar the average is (5 × 4,000 + 5 × 7,000) / 10 = 5,500 €
  const mixedId = await addCurrentAccount("Topped up", 4000, "2024-01-01");
  await call("POST", "/transactions", { type: "income", amount: 3000, to_account_id: mixedId, category_id: dataset.categoryIds.salary, date: "2025-03-06" });
  // savings accounts and cash are never in this list (current accounts only)
  const accountsOf = async (from, to) => (await buildFinancialStatements(from, to)).tax_estimates.period.current_accounts;

  const year2024 = await accountsOf("2024-01-01", "2024-12-31"); // 366 days: 34.20 × 366/365
  assert.deepEqual(year2024.find((account) => account.name === "Just over"), { name: "Just over", average_balance: 5000.01, stamp_duty: 34.29 });
  assert.equal(year2024.find((account) => account.name === "Exactly 5000").stamp_duty, 0, "the threshold is 'above 5,000'");
  assert.ok(!year2024.some((account) => account.name === "Savings" || account.name === "Cash"));

  const tenDays = await accountsOf("2025-03-01", "2025-03-10");
  const toppedUp = tenDays.find((account) => account.name === "Topped up");
  assert.equal(toppedUp.average_balance, 5500);
  assert.equal(toppedUp.stamp_duty, 0.94); // 34.20 × 10/365 = 0.937
  const beforeTopUp = (await accountsOf("2025-03-01", "2025-03-05")).find((account) => account.name === "Topped up");
  assert.deepEqual([beforeTopUp.average_balance, beforeTopUp.stamp_duty], [4000, 0]);
});

test("an account opened in the middle of the period counts 0 before it started", async () => {
  // opened 21 Jan 2023 with 10,000 €: over January the average is 11 days × 10,000 / 31 = 3,548.39 -> under the threshold
  await addCurrentAccount("New in January", 10000, "2023-01-21");
  const january = (await buildFinancialStatements("2023-01-01", "2023-01-31")).tax_estimates.period.current_accounts.find((account) => account.name === "New in January");
  assert.deepEqual([january.average_balance, january.stamp_duty], [3548.39, 0]);
});

test("capital gains tax: 26% of each sell's gain in the period, nothing on a loss", async () => {
  const statements = await buildFinancialStatements("2026-01-01", "2026-03-31");
  const { sells, capital_gains_tax: capitalGainsTax } = statements.tax_estimates.period;
  assert.deepEqual(sells.map((sell) => [sell.ticker, sell.date]), [["AAPL", "2026-01-15"], ["VWCE.MI", "2026-03-02"]]);
  // AAPL: sold 1 for 205 − 1 fee = 204; average cost 540.99 / 3 = 180.33 -> gain 23.67, tax 6.15
  assert.deepEqual(sells[0], { ticker: "AAPL", date: "2026-01-15", gain: 23.67, tax: 6.15 });
  assert.equal(toCents(capitalGainsTax), sells.reduce((sum, sell) => sum + toCents(sell.tax), 0));

  // a sell at a loss pays nothing
  await call("POST", "/investments/trades", { ticker: "AAPL", side: "sell", shares: 1, price: 100, date: "2026-05-04", account_id: dataset.accountIds.savings });
  const may = await buildFinancialStatements("2026-05-01", "2026-05-31");
  const lossSell = may.tax_estimates.period.sells.find((sell) => sell.date === "2026-05-04");
  assert.ok(lossSell.gain < 0);
  assert.equal(lossSell.tax, 0);

  assert.deepEqual((await buildFinancialStatements("2025-06-01", "2025-06-30")).tax_estimates.period.sells, [], "no sells, no tax");
});

test("the estimates sit next to the statements: totals and the bridge don't change", async () => {
  for (const [from, to] of [["2025-01-01", "2026-10-01"], ["2026-01-01", "2026-03-31"], ["2026-03-02", "2026-03-02"]]) {
    const statements = await buildFinancialStatements(from, to);
    assert.ok(statements.bridge.unexplained === 0, `${from} → ${to}`);
    assert.equal(toCents(statements.balance_sheet.closing), toCents(statements.bridge.closing));
    const { period } = statements.tax_estimates;
    assert.equal(toCents(period.total), toCents(period.stamp_duty_on_securities) + toCents(period.stamp_duty_on_current_accounts) + toCents(period.capital_gains_tax));
    // no tax in the income statement: its expenses are exactly the recorded ones
    const recordedExpenses = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'expense' AND date BETWEEN ? AND ?`).get(from, to).total;
    assert.equal(toCents(statements.income_statement.total_expenses), recordedExpenses);
  }
});
