/* STATEMENTS (backend/server/services/financialStatements.js)
 * The net worth bridge explains how the opening net worth became the closing one, step by step.
 * Every step is computed separately from the balance sheet, so for ANY period:
 *
 *   bridge.unexplained = closing − opening − all steps   must be exactly 0
 *   balance sheet closing (and opening)                   must equal the bridge's
 *   the liquidity classes                                 must add up to the balance sheet totals
 *   one period's opening                                  must equal the closing of the day before
 *
 * Checked on hand-picked periods (whole months, years, single days, days with a trade or an account
 * opening...) and on random ones. The random periods come from a fixed seed, so a failure can be repeated.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { buildFinancialStatements } = require("../backend/server/services/financialStatements.js");
const { getTodayAsLocalDate } = require("../backend/server/utils/localDates.js");
const { addDays } = require("../backend/server/services/netWorthHistory.js");

const NUMBER_OF_RANDOM_PERIODS = 80;
const RANDOM_SEED = 20261014;

const db = openTestDatabase();
let callApi, stopServer;

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  await buildFakeDataset(callApi, db);
});
after(() => stopServer());

// A small seeded random number generator (mulberry32): the same seed always gives the same numbers,
// unlike Math.random, so a failing random period shows up again on the next run
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function nextRandomNumber() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Euros back to whole cents, so sums of euro floats can be compared exactly
const toCents = (euros) => Math.round(euros * 100);

function assertStatementsAddUp(statements, period) {
  const { bridge, balance_sheet: balanceSheet } = statements;
  assert.ok(bridge.unexplained === 0, `${period}: bridge.unexplained is ${bridge.unexplained}, not 0`);
  assert.equal(toCents(balanceSheet.closing), toCents(bridge.closing), `${period}: balance sheet closing vs bridge closing`);
  assert.equal(toCents(balanceSheet.opening), toCents(bridge.opening), `${period}: balance sheet opening vs bridge opening`);

  const stepsTotal = bridge.steps.reduce((sum, step) => sum + toCents(step.amount), 0);
  assert.equal(toCents(bridge.opening) + stepsTotal, toCents(bridge.closing), `${period}: opening + steps = closing`);

  for (const side of ["opening", "closing"]) {
    const classesTotal = balanceSheet.classes.reduce((sum, liquidityClass) => sum + toCents(liquidityClass[side]), 0);
    assert.equal(classesTotal, toCents(balanceSheet[side]), `${period}: liquidity classes add up to the ${side} total`);
    for (const liquidityClass of balanceSheet.classes) {
      const itemsTotal = liquidityClass.items.reduce((sum, item) => sum + toCents(item[side]), 0);
      assert.equal(itemsTotal, toCents(liquidityClass[side]), `${period}: items of ${liquidityClass.key} add up (${side})`);
    }
  }
  assert.deepEqual(statements.failed_tickers, [], `${period}: every ticker has fake prices`);
}

async function checkPeriod(from, to) {
  const period = `${from} → ${to}`;
  const statements = await buildFinancialStatements(from, to);
  assertStatementsAddUp(statements, period);

  // continuity: what this period opens with is what the day before closed with
  const dayBefore = addDays(from, -1);
  const dayBeforeStatements = await buildFinancialStatements(dayBefore, dayBefore);
  assert.equal(toCents(dayBeforeStatements.bridge.closing), toCents(statements.bridge.opening), `${period}: opening = closing of ${dayBefore}`);
  return statements;
}

function listHandPickedPeriods(today) {
  const periods = [
    ["2024-06-01", today],        // starts before anything was recorded
    ["2025-01-01", today],        // everything
    ["2025-01-01", "2025-12-31"], // a whole year
    ["2026-01-01", today],        // year to date
    [today, today],               // just today (the reconciliation, the live prices)
    ["2025-02-10", "2025-02-10"], // the first trade's day
    ["2025-05-05", "2025-05-05"], // the trade with no account (an opening position)
    ["2026-03-02", "2026-03-02"], // the sell into savings
    ["2025-06-15", "2025-06-15"], // the cash account opens
    ["2025-09-01", "2025-09-30"], // the car is added
    ["2025-03-01", "2025-04-30"], // the old card, used then emptied
    ["2024-01-01", "2024-12-31"], // entirely before anything: all zero
  ];
  for (let month = 1; month <= 12; month++) {           // every month of 2025
    const firstDay = `2025-${String(month).padStart(2, "0")}-01`;
    const lastDay = addDays(month === 12 ? "2026-01-01" : `2025-${String(month + 1).padStart(2, "0")}-01`, -1);
    periods.push([firstDay, lastDay]);
  }
  return periods;
}

test("hand-picked periods: the bridge explains everything and matches the balance sheet", async () => {
  const today = getTodayAsLocalDate();
  for (const [from, to] of listHandPickedPeriods(today)) await checkPeriod(from, to);
});

test(`${NUMBER_OF_RANDOM_PERIODS} random periods: the bridge explains everything and matches the balance sheet`, async () => {
  const today = getTodayAsLocalDate();
  const nextRandomNumber = createSeededRandom(RANDOM_SEED);
  const earliestDay = "2024-10-01";
  const daysAvailable = Math.round((Date.parse(today) - Date.parse(earliestDay)) / 864e5);
  for (let periodNumber = 0; periodNumber < NUMBER_OF_RANDOM_PERIODS; periodNumber++) {
    const from = addDays(earliestDay, Math.floor(nextRandomNumber() * (daysAvailable + 1)));
    const daysLeft = Math.round((Date.parse(today) - Date.parse(from)) / 864e5);
    const to = addDays(from, Math.floor(nextRandomNumber() * (daysLeft + 1)));
    await checkPeriod(from, to);
  }
});

test("the bridge steps hold the expected amounts for a known period", async () => {
  // 2025-12 (month 11 of the dataset): salary 2100.50 + meal vouchers 160 + gift received 100 in;
  // groceries, groceries paid with vouchers, gift given, rent out (no cash groceries: those are in even months)
  const statements = await buildFinancialStatements("2025-12-01", "2025-12-31");
  const stepAmount = (key) => statements.bridge.steps.find((step) => step.key === key).amount;
  assert.equal(stepAmount("income"), 2100.5 + 160 + 100);
  const groceriesInDecember = Math.round((87.3 + 11 * 3.17) * 100) / 100;
  assert.equal(toCents(stepAmount("expenses")), -toCents(groceriesInDecember + 151.25 + 50 + 700));
  assert.equal(stepAmount("reconciliations"), 0);
  assert.equal(stepAmount("starting_balances"), 0);
  assert.equal(statements.income_statement.total_income, stepAmount("income"));
});

test("the opening position trade counts as a starting balance, not as income", async () => {
  const statements = await buildFinancialStatements("2025-05-05", "2025-05-05");
  const stepAmount = (key) => statements.bridge.steps.find((step) => step.key === key).amount;
  assert.equal(stepAmount("income"), 0);
  assert.equal(stepAmount("starting_balances"), 540.99); // 3 × 180.33
});

test("GET /statements answers the same thing, and refuses a period that ends before it starts", async () => {
  const today = getTodayAsLocalDate();
  const statements = await callApiExpectingSuccess(callApi, "GET", `/statements?from=2025-01-01&to=2999-12-31`);
  assert.equal(statements.to, today, "a period ending in the future stops today");
  assertStatementsAddUp(statements, "GET /statements");

  const reversed = await callApi("GET", "/statements?from=2026-02-01&to=2026-01-01");
  assert.equal(reversed.status, 400);
});
