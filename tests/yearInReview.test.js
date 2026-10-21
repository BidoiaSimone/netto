/* YEAR IN REVIEW (services/yearInReview.js): built from the statements, so for the same year its totals must be
 * exactly the Statements page's. The fake dataset covers 2025 (complete) and 2026 (year-to-date).
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { getTodayAsLocalDate } = require("../backend/server/utils/localDates.js");

const db = openTestDatabase();
let callApi, stopServer;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const toCents = (euros) => Math.round(euros * 100);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  await buildFakeDataset(callApi, db);
});
after(() => stopServer());

for (const year of [2025, Number(getTodayAsLocalDate().slice(0, 4))]) {
  test(`${year}: every total equals the Statements page for the same year`, async () => {
    const review = await call("GET", `/year-in-review?year=${year}`);
    const statements = await call("GET", `/statements?from=${year}-01-01&to=${year}-12-31`);
    assert.equal(review.from, statements.from);
    assert.equal(review.to, statements.to);
    assert.equal(review.income, statements.income_statement.total_income);
    assert.equal(review.expenses, statements.income_statement.total_expenses);
    assert.equal(review.net_savings, statements.income_statement.net_savings);
    assert.equal(review.savings_rate, statements.income_statement.savings_rate);
    assert.equal(review.net_worth.start, statements.bridge.opening);
    assert.equal(review.net_worth.end, statements.bridge.closing);
    assert.equal(review.net_worth.end, statements.balance_sheet.closing);
    assert.equal(toCents(review.net_worth.from_savings) + toCents(review.net_worth.from_investments) + toCents(review.net_worth.other), toCents(review.net_worth.change), "the parts add up to the change");
    assert.equal(toCents(review.net_worth.start) + toCents(review.net_worth.change), toCents(review.net_worth.end));
    assert.equal(review.net_worth.from_investments, statements.bridge.steps.find((step) => step.key === "investment_results").amount);
    assert.equal(review.stamp_duty.securities, statements.tax_estimates.period.stamp_duty_on_securities);
    assert.equal(review.stamp_duty.current_accounts, statements.tax_estimates.period.stamp_duty_on_current_accounts);

    // the months add up to the year, and the top categories are the income statement's biggest
    assert.equal(review.months.reduce((sum, month) => sum + toCents(month.income), 0), toCents(review.income));
    assert.equal(review.months.reduce((sum, month) => sum + toCents(month.expenses), 0), toCents(review.expenses));
    assert.deepEqual(review.top_expense_categories.map((category) => category.name), statements.income_statement.expenses.slice(0, 5).map((row) => row.name));
    if (review.investments) {
      assert.equal(review.investments.gain, statements.investment_returns.total.gain);
      assert.equal(review.investments.money_weighted.annual, statements.investment_returns.total.money_weighted.annual);
    }
  });
}

test("2025: complete year, its trip, its investments, and no year before to compare with", async () => {
  const review = await call("GET", "/year-in-review?year=2025");
  assert.equal(review.is_year_to_date, false);
  assert.equal(review.category_changes, null, "no 2024 data");
  assert.equal(review.months.length, 12);

  assert.equal(review.trips.length, 1);
  const lisbon = review.trips[0];
  assert.equal(lisbon.name, "Lisbon 2025");
  assert.equal(lisbon.days, 5);                // 10–14 September
  assert.equal(lisbon.spent, 100.45);
  assert.equal(lisbon.received, 15);           // the train delay refund
  assert.equal(lisbon.cost, 85.45);
  assert.equal(lisbon.cost_per_day, 17.09);
  assert.equal(lisbon.exchange_cost, 0);

  assert.equal(review.investments.bought, 2095.49); // VWCE 1.001,50 + 553,00, AAPL opening position 540,99
  assert.equal(review.investments.sold, 0);
  assert.deepEqual(review.investments.allocation.map((row) => row.ticker).sort(), ["AAPL", "VWCE.MI"]);
  assert.ok(Math.abs(review.investments.allocation.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-9);

  const best = review.best_month, worst = review.worst_month;
  assert.ok(review.months.every((month) => month.saved <= best.saved && month.saved >= worst.saved));
});

test("this year: year-to-date, compared with the same dates a year earlier, best and worst only among complete months", async () => {
  const today = getTodayAsLocalDate();
  const year = Number(today.slice(0, 4));
  const review = await call("GET", `/year-in-review?year=${year}`);
  assert.equal(review.is_year_to_date, today < `${year}-12-31`);
  assert.equal(review.to, today);
  assert.deepEqual(review.category_changes.compared_with, { from: `${year - 1}-01-01`, to: `${year - 1}${today.slice(4)}` });
  const groceries = [...review.category_changes.grew, ...review.category_changes.shrank].find((row) => row.name === "Groceries");
  if (groceries) assert.equal(toCents(groceries.change), toCents(groceries.this_year) - toCents(groceries.year_before));
  const isLastDayOfMonth = Number(today.slice(8)) === new Date(Date.UTC(year, Number(today.slice(5, 7)), 0)).getUTCDate();
  if (!isLastDayOfMonth) {
    for (const month of [review.best_month, review.worst_month].filter(Boolean)) assert.ok(month.month < today.slice(0, 7), "the month still running isn't judged");
  }
  assert.deepEqual(review.years_available, [year, ...(year > 2025 ? Array.from({ length: year - 2025 }, (unused, index) => year - 1 - index) : [])]);
});

test("a year without records, or not a year, is refused", async () => {
  assert.equal((await callApi("GET", "/year-in-review?year=2019")).status, 400);
  assert.equal((await callApi("GET", "/year-in-review?year=next")).status, 400);
  assert.equal((await callApi("GET", "/year-in-review")).status, 200, "no year = this year");
});
