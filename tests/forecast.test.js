/* FORECAST (migration 12, services/forecastSimulation.js, services/forecast.js, routes/forecastRoutes.js)
 * The simulation is checked against cases with a formula: a straight line with no returns, compound interest,
 * an annuity (monthly savings invested), depreciation, inflation; then the plan's behaviour: phases, events,
 * the shortfall cover and its warnings; then the real-data parts: averages, API, backups.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { simulateForecast, findPhaseOfMonth, calculateRunwayInMonths } = require("../backend/server/services/forecastSimulation.js");
const { buildForecast, calculateRealAverages } = require("../backend/server/services/forecast.js");
const { sumRecurringExpensesStillDue } = require("../backend/server/services/budgetCalculator.js");
const { LATEST_DATABASE_VERSION } = require("../backend/db/migrations/allMigrationsInOrder.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

const assertClose = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} expected ${expected}, got ${actual}`);

// A plan with nothing switched on; each test turns on what it checks. Money in cents.
const NO_ASSUMPTIONS = { yearlyReturn: 0, yearlyInflation: 0, savingsGoTo: "cash", yearlyDepreciation: 0 };
const simulate = (overrides) => simulateForecast({
  startDate: "2026-10-14", months: 120,
  start: { cash: 0, investments: 0, personalUseAssets: [] }, phases: [], events: [], assumptions: NO_ASSUMPTIONS,
  ...overrides,
});
const phase = (name, fromMonth, monthlyIncome, monthlyExpenses) => ({ name, fromMonth, monthlyIncome, monthlyExpenses });

// ---------- the maths ----------

test("zero return, zero inflation: saving the same amount every month is a straight line", () => {
  const { points } = simulate({
    start: { cash: 100000, investments: 500000, personalUseAssets: [] },
    phases: [phase("Steady", "2026-10", 250000, 200000)], // saves 500 € a month
  });
  assert.equal(points.length, 121);
  points.forEach((point, step) => {
    assert.equal(point.netWorth, 600000 + step * 50000, `month ${step}`);
    assert.equal(point.investments, 500000, "no return: investments don't move");
  });
  // a straight line: every step is the same size
  const steps = points.slice(1).map((point, index) => point.netWorth - points[index].netWorth);
  assert.ok(steps.every((step) => step === 50000));
});

test("compound interest: 10,000 € at 5% a year for 10 years = 10,000 × 1.05^10 = 16,288.95 €", () => {
  const { points } = simulate({ start: { cash: 0, investments: 1000000, personalUseAssets: [] }, assumptions: { ...NO_ASSUMPTIONS, yearlyReturn: 0.05 } });
  assert.equal(points[12].investments, 1050000, "one year: exactly +5% (twelve monthly steps of 1.05^(1/12))");
  assert.equal(points[120].investments, 1628895);
});

test("investing 200 € every month at 5% a year: the annuity formula", () => {
  // each month's saving is added after that month's growth, so after n months:
  //   FV = 200 × ((1 + m)^n − 1) / m   with m = 1.05^(1/12) − 1 (the monthly rate)
  const { points } = simulate({
    phases: [phase("Working", "2026-10", 200000, 180000)],
    assumptions: { ...NO_ASSUMPTIONS, yearlyReturn: 0.05, savingsGoTo: "investments" },
  });
  const monthlyRate = Math.pow(1.05, 1 / 12) - 1;
  for (const months of [12, 60, 120]) {
    assertClose(points[months].investments, 20000 * (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate, 1, `${months} months`);
  }
  assert.equal(points[120].cash, 0, "everything went into investments");
});

test("depreciation: the car loses 15% a year, a bit each month", () => {
  const { points } = simulate({
    start: { cash: 0, investments: 0, personalUseAssets: [{ accountId: 1, name: "Polo", value: 800000 }] },
    assumptions: { ...NO_ASSUMPTIONS, yearlyDepreciation: 0.15 },
  });
  assert.equal(points[12].personalUse, 680000);                       // 8,000 × 0.85
  assert.equal(points[24].personalUse, Math.round(800000 * 0.85 ** 2)); // 5,780
  assert.ok(points[6].personalUse < 800000 && points[6].personalUse > 680000);
});

test("inflation: phase amounts grow with prices, and in today's euros a return equal to inflation stands still", () => {
  const { points } = simulate({
    start: { cash: 5000000, investments: 1000000, personalUseAssets: [] }, // enough cash: no investment is sold
    phases: [phase("Spending", "2026-10", 0, 100000)], // 1,000 € a month at today's prices
    assumptions: { ...NO_ASSUMPTIONS, yearlyReturn: 0.02, yearlyInflation: 0.02 },
  });
  assertClose(points[12].deflator, 1.02, 1e-12);
  assertClose(points[12].investments / points[12].deflator, 1000000, 1, "2% return with 2% inflation: same buying power");
  // month 12's expense is 1,000 € × 1.02 in that month's euros: cash goes down by exactly that
  assertClose(points[11].cash - points[12].cash, 102000, 1);
});

// ---------- phases, events, shortfall ----------

test("master's then job: the slope changes exactly when the next phase starts", () => {
  const phases = [phase("Master's", "2026-10", 30000, 140000), phase("Working", "2028-10", 200000, 160000)];
  const { points } = simulate({ start: { cash: 3000000, investments: 0, personalUseAssets: [] }, phases });
  assert.equal(points[23].phaseName, "Master's");   // Sep 2028
  assert.equal(points[24].phaseName, "Working");    // Oct 2028
  assert.equal(points[23].cash - points[24].cash, -40000, "Oct 2028: +400 € a month");
  assert.equal(points[22].cash - points[23].cash, 110000, "Sep 2028: −1,100 € a month");
  assert.equal(points[24].cash, 3000000 - 23 * 110000 + 40000);
  // the earliest phase also covers today, even if it was set to start later
  assert.equal(findPhaseOfMonth([phase("Later", "2027-01", 0, 0)], "2026-10").name, "Later");
  assert.equal(findPhaseOfMonth([], "2026-10"), null);
});

test("an event that sells the car: its value leaves, the money arrives, nothing is counted twice", () => {
  const { points } = simulate({
    start: { cash: 100000, investments: 0, personalUseAssets: [{ accountId: 7, name: "Polo", value: 800000 }] },
    events: [{ name: "Sell the Polo", month: "2028-06", amount: 600000, sellsAccountId: 7 }],
  });
  const saleStep = points.findIndex((point) => point.month === "2028-06");
  assert.equal(saleStep, 20);
  assert.equal(points[saleStep - 1].personalUse, 800000);
  assert.deepEqual([points[saleStep].personalUse, points[saleStep].cash], [0, 700000]);
  assert.equal(points[saleStep].netWorth - points[saleStep - 1].netWorth, -200000, "sold for 2,000 € less than its value");

  // an event in the past (or this month) is ignored and reported
  const past = simulate({ events: [{ name: "Old", month: "2026-09", amount: 1000, sellsAccountId: null }, { name: "Now", month: "2026-10", amount: 1000, sellsAccountId: null }] });
  assert.equal(past.ignoredEvents.length, 2);
  assert.equal(past.points[120].cash, 0);
});

test("when cash runs out, investments cover it; when they run out too, the shortfall is reported", () => {
  // 1,000 € cash, 5,000 € invested, 500 € a month short, no returns:
  //   month 2: cash 0; month 3: cash would be −500 -> 500 € of investments sold (cash runs out in Jan 2027)
  //   months 3 to 12 use up the 5,000 €; month 13 (Nov 2027): nothing left -> short
  const result = simulate({ start: { cash: 100000, investments: 500000, personalUseAssets: [] }, phases: [phase("Master's", "2026-10", 0, 50000)] });
  assert.deepEqual(result.cashRunsOut, { date: "2027-01-14", month: "2027-01" });
  assert.equal(result.points[3].investmentsSold, 50000);
  assert.deepEqual([result.points[3].cash, result.points[3].investments], [0, 450000]);
  assert.equal(result.points[12].investments, 0);
  assert.deepEqual(result.investmentsRunOut, { date: "2027-11-14", month: "2027-11" });
  assert.equal(result.points[13].cash, -50000);
  assert.equal(result.lowestCash.value, result.points[120].cash);
  assert.equal(result.largestShortfall, 50000 * 108);

  // a good plan never warns
  const fine = simulate({ start: { cash: 100000, investments: 0, personalUseAssets: [] }, phases: [phase("Working", "2026-10", 200000, 150000)] });
  assert.deepEqual([fine.cashRunsOut, fine.investmentsRunOut, fine.largestShortfall], [null, null, 0]);
});

test("a surplus goes to cash or to investments as chosen; a deficit always comes out of cash first", () => {
  const plan = { start: { cash: 100000, investments: 100000, personalUseAssets: [] }, phases: [phase("A", "2026-10", 100000, 50000)] };
  const toCash = simulate(plan), toInvestments = simulate({ ...plan, assumptions: { ...NO_ASSUMPTIONS, savingsGoTo: "investments" } });
  assert.deepEqual([toCash.points[1].cash, toCash.points[1].investments], [150000, 100000]);
  assert.deepEqual([toInvestments.points[1].cash, toInvestments.points[1].investments], [100000, 150000]);
  const deficit = simulate({ ...plan, phases: [phase("B", "2026-10", 0, 50000)], assumptions: { ...NO_ASSUMPTIONS, savingsGoTo: "investments" } });
  assert.deepEqual([deficit.points[1].cash, deficit.points[1].investments], [50000, 100000]);
});

test("runway: money that can be spent ÷ the monthly deficit", () => {
  assert.equal(calculateRunwayInMonths(2200000, phase("Master's", "2026-10", 30000, 140000)), 20); // 22,000 / 1,100
  assert.equal(calculateRunwayInMonths(2200000, phase("Working", "2026-10", 200000, 160000)), null, "no deficit, no runway to count");
  assert.equal(calculateRunwayInMonths(2200000, null), null);
});

// ---------- real data ----------

test("the suggested first phase comes from the last complete months, and says so", () => {
  // the dataset's complete months up to September 2026; up to 6 are used: April – September
  const averages = calculateRealAverages("2026-10-14");
  assert.equal(averages.monthsOfData, 6);
  assert.match(averages.source, /6 complete months \(April – September\)/);
  const expensesAprilToSeptember = db.prepare(`SELECT SUM(amount) AS total FROM transactions WHERE type = 'expense' AND date BETWEEN '2026-04-01' AND '2026-09-30'`).get().total;
  assert.equal(averages.monthlyExpenses, Math.round(expensesAprilToSeptember / 6));
  assert.equal(averages.usesBudgets, false);
});

test("with no complete month yet, the current month so far is projected like on Insights", () => {
  // the first record is 1 Jan 2025: on 10 Jan 2025 there is no complete month.
  // habitual categories at the pace (÷ 10 days × 31), one-off ones and recurring as they are, + recurring still due
  // the category with the most spending in those days becomes one-off for this test
  const biggestCategoryId = db.prepare(`SELECT category_id FROM transactions WHERE type = 'expense' AND recurring_transaction_id IS NULL
    AND category_id IS NOT NULL AND date BETWEEN '2025-01-01' AND '2025-01-10' GROUP BY category_id ORDER BY SUM(amount) DESC LIMIT 1`).get().category_id;
  db.prepare(`UPDATE categories SET spending_pace = 'occasional' WHERE id = ?`).run(biggestCategoryId);
  const averages = calculateRealAverages("2025-01-10");
  assert.equal(averages.monthsOfData, 0);
  assert.match(averages.source, /No complete month of records yet/);
  const sumByTheTenth = (condition) => db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) AS total FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND t.date BETWEEN '2025-01-01' AND '2025-01-10' AND ${condition}`).get().total;
  const habitual = sumByTheTenth(`t.recurring_transaction_id IS NULL AND COALESCE(c.spending_pace, 'daily') = 'daily'`);
  const asTheyAre = sumByTheTenth(`(t.recurring_transaction_id IS NOT NULL OR c.spending_pace = 'occasional')`);
  const stillDue = [...sumRecurringExpensesStillDue("2025-01-10", "2025-01-31").values()].reduce((sum, amount) => sum + amount, 0);
  assert.ok(asTheyAre > 0);
  assert.equal(averages.monthlyExpenses, Math.round((habitual / 10) * 31 + asTheyAre + stillDue));
  db.prepare(`UPDATE categories SET spending_pace = 'daily' WHERE id = ?`).run(biggestCategoryId);
});

test("with budgets, expenses = the budgets + what unbudgeted categories usually cost", async () => {
  const thisMonth = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  await call("PUT", `/categories/${dataset.categoryIds.groceries}/budget`, { monthly_limit: 250, from_month: "2026-10" });
  const averages = calculateRealAverages("2026-10-14");
  const notGroceries = db.prepare(`SELECT SUM(amount) AS total FROM transactions WHERE type = 'expense' AND date BETWEEN '2026-04-01' AND '2026-09-30' AND (category_id IS NULL OR category_id <> ?)`).get(dataset.categoryIds.groceries).total;
  assert.equal(averages.usesBudgets, true);
  assert.equal(averages.monthlyExpenses, Math.round(25000 + notGroceries / 6));
  // the emergency fund (useBudgets: false) still gets what was really spent
  const realSpending = db.prepare(`SELECT SUM(amount) AS total FROM transactions WHERE type = 'expense' AND date BETWEEN '2026-04-01' AND '2026-09-30'`).get().total;
  assert.equal(calculateRealAverages("2026-10-14", { useBudgets: false }).monthlyExpenses, Math.round(realSpending / 6));
  await call("PUT", `/categories/${dataset.categoryIds.groceries}/budget`, { monthly_limit: null, from_month: "2026-10" });
  assert.ok(thisMonth); // (budgets set for a past month don't matter to the rest of the file)
});

test("GET /insights/monthly-expenses: the emergency fund's monthly expenses, the same average as the Forecast's", async () => {
  const answer = await call("GET", "/insights/monthly-expenses");
  const averages = calculateRealAverages(new Date().toLocaleDateString("sv-SE"), { useBudgets: false });
  assert.equal(Math.round(answer.monthly_expenses * 100), averages.monthlyExpenses);
  assert.equal(answer.months_of_data, averages.monthsOfData);
  assert.equal(answer.source, averages.source);
});

test("the starting point is today's real net worth, split into cash, investments and personal-use", async () => {
  const forecast = await call("GET", "/forecast");
  const netWorth = await call("GET", "/net-worth");
  const today = forecast.forecast[0];
  assert.equal(Math.round(today.net_worth * 100), Math.round(netWorth.net_worth * 100));
  assert.equal(Math.round(today.personal_use * 100), Math.round(netWorth.by_liquidity.personal_use * 100));
  assert.equal(Math.round(today.cash * 100), Math.round((netWorth.by_liquidity.cash_and_equivalents + netWorth.by_liquidity.restricted) * 100));
  assert.equal(forecast.forecast.length, 121);
  assert.ok(forecast.history.length >= 1 && forecast.history.every((point) => point.date < today.date));
  assert.ok(forecast.suggested_phase, "no phases yet: the suggestion is used");
  // the band: 0% below, 8% above (there are investments)
  for (const step of [12, 60, 120]) assert.ok(forecast.band.low[step] <= forecast.forecast[step].net_worth && forecast.forecast[step].net_worth <= forecast.band.high[step]);
});

test("setting up 'master's then job' through the API, with the car sold in between", async () => {
  await call("POST", "/forecast/phases", { name: "Master's", from_month: "2026-10", monthly_income: 300, monthly_expenses: 1400 });
  await call("POST", "/forecast/phases", { name: "Working", from_month: "2028-10", monthly_income: 2000, monthly_expenses: 1600 });
  await call("POST", "/forecast/events", { name: "Sell the car", month: "2028-06", amount: 6000, sells_account_id: dataset.accountIds.car });
  const forecast = await call("PUT", "/forecast/assumptions", { yearly_return: 0.05, yearly_inflation: 0.02, savings_go_to: "investments", yearly_depreciation: 0.15 });

  assert.equal(forecast.suggested_phase, null);
  assert.deepEqual(forecast.phases.map((saved) => [saved.name, saved.from_month, saved.until_month]), [["Master's", "2026-10", "2028-09"], ["Working", "2028-10", null]]);
  assert.equal(forecast.key_numbers.runway.phase_name, "Master's");
  assert.equal(forecast.key_numbers.runway.monthly_deficit, 1100);
  assertClose(forecast.key_numbers.runway.months, forecast.key_numbers.runway.liquid_now / 1100, 0.05);
  assert.deepEqual(forecast.key_numbers.net_worth_in.map((point) => point.years), [1, 2, 5, 10]);
  const saleMonth = forecast.forecast.find((point) => point.date.startsWith("2028-06"));
  assert.equal(saleMonth.personal_use, 0);
  assert.equal(forecast.events[0].is_past, false);

  // the same start month twice is refused; bad values are refused
  assert.equal((await callApi("POST", "/forecast/phases", { name: "Again", from_month: "2028-10" })).status, 409);
  for (const body of [{ name: "", from_month: "2027-01" }, { name: "X", from_month: "2027-13" }, { name: "X", from_month: "2027-01", monthly_income: -5 }]) {
    assert.equal((await callApi("POST", "/forecast/phases", body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await callApi("POST", "/forecast/events", { name: "Zero", month: "2027-01", amount: 0 })).status, 400);
  assert.equal((await callApi("POST", "/forecast/events", { name: "Not an asset", month: "2027-01", amount: 5, sells_account_id: dataset.accountIds.cash })).status, 400);
  assert.equal((await callApi("PUT", "/forecast/assumptions", { yearly_return: 0.5 })).status, 400);
  assert.equal((await callApi("PUT", "/forecast/assumptions", { savings_go_to: "mattress" })).status, 400);
});

test("editing and deleting phases and events", async () => {
  let forecast = await call("GET", "/forecast");
  const working = forecast.phases.find((saved) => saved.name === "Working");
  forecast = await call("PUT", `/forecast/phases/${working.id}`, { name: "First job", from_month: "2028-11", monthly_income: 2100, monthly_expenses: 1600 });
  assert.deepEqual(forecast.phases.map((saved) => saved.until_month), ["2028-10", null]);
  forecast = await call("DELETE", `/forecast/events/${forecast.events[0].id}`);
  assert.deepEqual(forecast.events, []);
  assert.equal((await callApi("DELETE", "/forecast/phases/99999")).status, 404);
});

test("phases, events and assumptions survive a JSON backup; an older backup gets the defaults", async () => {
  await call("POST", "/forecast/events", { name: "Bonus", month: "2027-06", amount: 1500 });
  const exported = await call("GET", "/export");
  assert.equal(exported.format_version, LATEST_DATABASE_VERSION);
  const planBefore = { phases: db.prepare(`SELECT * FROM forecast_phases ORDER BY id`).all(), events: db.prepare(`SELECT * FROM forecast_events ORDER BY id`).all(), assumptions: db.prepare(`SELECT * FROM forecast_assumptions`).get() };
  assert.equal(planBefore.assumptions.savings_go_to, "investments");

  await call("POST", "/import", exported);
  assert.deepEqual({ phases: db.prepare(`SELECT * FROM forecast_phases ORDER BY id`).all(), events: db.prepare(`SELECT * FROM forecast_events ORDER BY id`).all(), assumptions: db.prepare(`SELECT * FROM forecast_assumptions`).get() }, planBefore);

  const { forecast_phases: phases, forecast_events: events, forecast_assumptions: assumptions, ...olderBackup } = exported;
  await call("POST", "/import", { ...olderBackup, format_version: 11 });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM forecast_phases`).get().n, 0);
  assert.deepEqual(db.prepare(`SELECT yearly_return, yearly_inflation, savings_go_to, yearly_depreciation FROM forecast_assumptions`).get(),
    { yearly_return: 0.05, yearly_inflation: 0.02, savings_go_to: "cash", yearly_depreciation: 0.15 });
  await call("POST", "/import", exported);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM forecast_phases`).get().n, phases.length);
  assert.ok(events.length && assumptions);
});
