/* BUDGETS (migration 11, routes/budgetRoutes.js, services/budgetCalculator.js)
 * Monthly limits per expense category, with history. Checked here: splitting a period into (partial) months,
 * setting and changing limits, this month's progress and projection (Insights), and budget vs actual for any
 * period (Statements), prorated by days for partial months. The expected numbers are worked out by hand in the
 * comments, so a wrong formula can't pass by agreeing with itself.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { allMigrationsInOrder, LATEST_DATABASE_VERSION } = require("../backend/db/migrations/allMigrationsInOrder.js");
const { runPendingMigrations } = require("../backend/db/migrations/migrationRunner.js");
const { listMonthsOfPeriod, buildMonthBudgetProgress, buildBudgetVsActual } = require("../backend/server/services/budgetCalculator.js");
const { getTodayAsLocalDate } = require("../backend/server/utils/localDates.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

const addCategory = async (name) => (await call("POST", "/categories", { name, kind: "expense" })).id;
const setBudget = (categoryId, monthlyLimit, fromMonth) => call("PUT", `/categories/${categoryId}/budget`, { monthly_limit: monthlyLimit, from_month: fromMonth });
const addExpense = (categoryId, amount, date) => call("POST", "/transactions", { type: "expense", amount, from_account_id: dataset.accountIds.cash, category_id: categoryId, date });
const budgetRows = (categoryId) => db.prepare(`SELECT from_month, monthly_limit FROM category_budgets WHERE category_id = ? ORDER BY from_month`).all(categoryId);
const toCents = (euros) => Math.round(euros * 100);

// "Eating out", a category of its own so the dataset's other spending can't change the expected numbers:
//   budget history  300 € from Jan 2026, 450 € from Mar 2026, none from May 2026
//   expenses        10 Jan 100 · 25 Jan 50 · 15 Feb 400 · 5 Mar 200 · 1 Apr 10 · 3 May 99
let eatingOutId;

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
  eatingOutId = await addCategory("Eating out");
  await setBudget(eatingOutId, 300, "2026-01");
  await setBudget(eatingOutId, 450, "2026-03");
  await setBudget(eatingOutId, null, "2026-05");
  for (const [amount, date] of [[100, "2026-01-10"], [50, "2026-01-25"], [400, "2026-02-15"], [200, "2026-03-05"], [10, "2026-04-01"], [99, "2026-05-03"]]) {
    await addExpense(eatingOutId, amount, date);
  }
});
after(() => stopServer());

// ---------- months of a period ----------

test("a period is split into months, each with the days it covers", () => {
  assert.deepEqual(listMonthsOfPeriod("2026-01-20", "2026-03-10"), [
    { month: "2026-01", daysCovered: 12, daysInMonth: 31 },
    { month: "2026-02", daysCovered: 28, daysInMonth: 28 },
    { month: "2026-03", daysCovered: 10, daysInMonth: 31 },
  ]);
  assert.deepEqual(listMonthsOfPeriod("2026-04-07", "2026-04-07"), [{ month: "2026-04", daysCovered: 1, daysInMonth: 30 }]);
  assert.deepEqual(listMonthsOfPeriod("2028-02-01", "2028-02-29"), [{ month: "2028-02", daysCovered: 29, daysInMonth: 29 }], "leap year");
  assert.deepEqual(listMonthsOfPeriod("2026-12-31", "2027-01-01").map((month) => [month.month, month.daysCovered]), [["2026-12", 1], ["2027-01", 1]], "across a new year");
  assert.equal(listMonthsOfPeriod("2025-01-01", "2026-12-31").length, 24);
});

// ---------- the migration ----------

test("migration 11 adds budgets to a version 10 database, and the table keeps itself tidy", () => {
  const olderDatabase = new Database(":memory:");
  olderDatabase.pragma("foreign_keys = OFF");
  for (let migrationNumber = 1; migrationNumber <= 10; migrationNumber++) allMigrationsInOrder[migrationNumber - 1](olderDatabase);
  olderDatabase.pragma("user_version = 10");
  olderDatabase.pragma("foreign_keys = ON");
  olderDatabase.exec(`INSERT INTO categories (id, name, kind) VALUES (3, 'Food', 'expense'), (4, 'Fun', 'expense')`);
  const originalLog = console.log;
  console.log = () => {};
  try { runPendingMigrations(olderDatabase); } finally { console.log = originalLog; }

  assert.equal(olderDatabase.pragma("user_version", { simple: true }), LATEST_DATABASE_VERSION);
  assert.deepEqual(olderDatabase.prepare(`SELECT id, name FROM categories ORDER BY id`).all(), [{ id: 3, name: "Food" }, { id: 4, name: "Fun" }]);
  olderDatabase.exec(`INSERT INTO category_budgets VALUES (3, '2026-01', 30000), (3, '2026-06', NULL), (4, '2026-01', 5000)`);
  assert.throws(() => olderDatabase.exec(`INSERT INTO category_budgets VALUES (3, '2026-01', 1)`), /UNIQUE|PRIMARY/, "one value per month");
  assert.throws(() => olderDatabase.exec(`INSERT INTO category_budgets VALUES (3, '2026-1', 100)`), /CHECK/, "months are YYYY-MM");
  assert.throws(() => olderDatabase.exec(`INSERT INTO category_budgets VALUES (3, '2026-02', 0)`), /CHECK/, "a limit is above 0");
  assert.throws(() => olderDatabase.exec(`INSERT INTO category_budgets VALUES (99, '2026-02', 100)`), /FOREIGN KEY/);
  olderDatabase.exec(`DELETE FROM categories WHERE id = 3`);
  assert.deepEqual(olderDatabase.prepare(`SELECT category_id FROM category_budgets`).all(), [{ category_id: 4 }], "a deleted category takes its budgets with it");
});

// ---------- setting a budget ----------

test("setting a budget: this month by default, again in the same month replaces it, back to the old value stores nothing", async () => {
  const categoryId = await addCategory("Books");
  const thisMonth = getTodayAsLocalDate().slice(0, 7);

  const answer = await call("PUT", `/categories/${categoryId}/budget`, { monthly_limit: 40 });
  assert.deepEqual(answer, { category_id: categoryId, from_month: thisMonth, monthly_limit: 40 });
  await call("PUT", `/categories/${categoryId}/budget`, { monthly_limit: "55.5" });
  assert.deepEqual(budgetRows(categoryId), [{ from_month: thisMonth, monthly_limit: 5550 }], "same month: replaced, not added");

  const listed = (await call("GET", "/categories")).find((category) => category.id === categoryId);
  assert.equal(listed.monthly_budget, 55.5);

  // with an older limit, going back to it in the same month leaves just the older row
  const withHistoryId = await addCategory("Magazines");
  await setBudget(withHistoryId, 20, "2025-06");
  await setBudget(withHistoryId, 25, thisMonth);
  await setBudget(withHistoryId, 20, thisMonth);
  assert.deepEqual(budgetRows(withHistoryId), [{ from_month: "2025-06", monthly_limit: 2000 }]);

  // removing it keeps the past: a "no budget" row from this month on
  await call("PUT", `/categories/${withHistoryId}/budget`, { monthly_limit: "" });
  assert.deepEqual(budgetRows(withHistoryId), [{ from_month: "2025-06", monthly_limit: 2000 }, { from_month: thisMonth, monthly_limit: null }]);
  assert.equal((await call("GET", "/categories")).find((category) => category.id === withHistoryId).monthly_budget, null);

  // removing one that never existed before stores nothing at all
  await call("PUT", `/categories/${categoryId}/budget`, { monthly_limit: null });
  assert.deepEqual(budgetRows(categoryId), []);
});

test("budgets are refused for income categories, bad amounts and bad months", async () => {
  assert.equal((await callApi("PUT", `/categories/${dataset.categoryIds.salary}/budget`, { monthly_limit: 100 })).status, 400);
  for (const body of [{ monthly_limit: -5 }, { monthly_limit: "abc" }, { monthly_limit: 0.004 }, { monthly_limit: 10, from_month: "2026-13" }, { monthly_limit: 10, from_month: "2026-1" }]) {
    assert.equal((await callApi("PUT", `/categories/${dataset.categoryIds.groceries}/budget`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await callApi("PUT", "/categories/99999/budget", { monthly_limit: 10 })).status, 404);
  assert.equal((await call("PUT", `/categories/${dataset.categoryIds.groceries}/budget`, { monthly_limit: 1.005 })).monthly_limit, 1.01, "rounded to the cent like every amount");
  await call("PUT", `/categories/${dataset.categoryIds.groceries}/budget`, { monthly_limit: null });
});

test("a budgeted category moved to the income list stops counting as a budget", async () => {
  const categoryId = await addCategory("Side costs");
  await setBudget(categoryId, 80);
  await call("PUT", `/categories/${categoryId}/kind`, { kind: "income" });
  assert.equal((await call("GET", "/categories")).find((category) => category.id === categoryId).monthly_budget, null);
  assert.ok(!buildMonthBudgetProgress(getTodayAsLocalDate()).categories.some((category) => category.category_id === categoryId));
});

// ---------- Statements: budget vs actual ----------

const findRow = (budgetVsActual, categoryId) => budgetVsActual.rows.find((row) => row.category_id === categoryId);

test("one whole month: the full limit against what was spent", () => {
  const row = findRow(buildBudgetVsActual("2026-01-01", "2026-01-31"), eatingOutId);
  assert.deepEqual(row, { category_id: eatingOutId, name: "Eating out", budget: 300, actual: 150, difference: 150, share_used: 0.5, budgeted_months: 1 });
});

test("partial months are prorated by days, across a limit change", () => {
  // 20 Jan – 10 Mar:  300 × 12/31 + 300 × 28/28 + 450 × 10/31 = 116.129… + 300 + 145.161… = 561.29
  // spent: 25 Jan 50 + 15 Feb 400 + 5 Mar 200 = 650 (the 10 Jan one is before the period)
  const row = findRow(buildBudgetVsActual("2026-01-20", "2026-03-10"), eatingOutId);
  assert.equal(row.budget, 561.29);
  assert.equal(row.actual, 650);
  assert.equal(row.difference, -88.71);
  assert.equal(row.budgeted_months, 1.71); // 12/31 + 1 + 10/31
});

test("a single day counts one day's share of the month", () => {
  // 7 Apr: 450 × 1/30 = 15.00
  assert.equal(findRow(buildBudgetVsActual("2026-04-07", "2026-04-07"), eatingOutId).budget, 15);
});

test("months without a budget: their spending is unbudgeted, even for a category budgeted in other months", () => {
  // 15 Apr – 31 May: April 450 × 16/30 = 240; May has no budget (removed), so its 99 € are unbudgeted
  const budgetVsActual = buildBudgetVsActual("2026-04-15", "2026-05-31");
  const row = findRow(budgetVsActual, eatingOutId);
  assert.deepEqual([row.budget, row.actual, row.budgeted_months], [240, 0, 0.53]);
  const allExpensesInPeriod = db.prepare(`SELECT SUM(amount) AS total FROM transactions WHERE type = 'expense' AND date BETWEEN '2026-04-15' AND '2026-05-31'`).get().total;
  assert.equal(toCents(budgetVsActual.unbudgeted_actual), allExpensesInPeriod - toCents(budgetVsActual.total_actual));
  assert.ok(budgetVsActual.unbudgeted_actual >= 99);

  assert.equal(findRow(buildBudgetVsActual("2025-01-01", "2025-12-31"), eatingOutId), undefined, "no budget at all in 2025: no row");
});

test("a whole year adds up every month's own limit, and the totals add up", () => {
  // 2026: Jan, Feb at 300; Mar, Apr at 450; nothing from May = 600 + 900 = 1,500
  const budgetVsActual = buildBudgetVsActual("2026-01-01", "2026-12-31");
  const row = findRow(budgetVsActual, eatingOutId);
  assert.deepEqual([row.budget, row.actual, row.budgeted_months], [1500, 760, 4]); // 150 + 400 + 200 + 10
  assert.equal(budgetVsActual.months, 12);
  const rowsTotal = budgetVsActual.rows.reduce((sum, budgetRow) => sum + toCents(budgetRow.budget), 0);
  assert.equal(toCents(budgetVsActual.total_budget), rowsTotal);
  assert.equal(toCents(budgetVsActual.total_difference), toCents(budgetVsActual.total_budget) - toCents(budgetVsActual.total_actual));
});

test("a leap February counts 29 days", () => {
  // 1 – 14 Feb 2028 with 300 €: 300 × 14/29 = 144.83 (no expense needed: the budget alone)
  const categoryId = db.prepare(`INSERT INTO categories (name, kind) VALUES ('Leap test', 'expense')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO category_budgets VALUES (?, '2028-01', 30000)`).run(categoryId);
  assert.equal(findRow(buildBudgetVsActual("2028-02-01", "2028-02-14"), categoryId).budget, 144.83);
  db.prepare(`DELETE FROM categories WHERE id = ?`).run(categoryId);
});

test("GET /statements carries the same budget vs actual, and the bridge still adds up", async () => {
  const statements = await call("GET", "/statements?from=2026-01-20&to=2026-03-10");
  assert.deepEqual(statements.budget_vs_actual, buildBudgetVsActual("2026-01-20", "2026-03-10"));
  assert.ok(statements.bridge.unexplained === 0);
});

// ---------- Insights: this month ----------

test("this month: spent so far, status, and the month-end projection (variable spending at its daily pace)", async () => {
  // 10 Feb 2026, Eating out (300 € in Feb): nothing spent yet by the 10th (the 400 € is on the 15th)
  let progress = buildMonthBudgetProgress("2026-02-10");
  assert.deepEqual(
    { month: progress.month, day: progress.day_of_month, days: progress.days_in_month, early: progress.is_early_in_the_month },
    { month: "2026-02", day: 10, days: 28, early: false });
  let eatingOut = progress.categories.find((category) => category.category_id === eatingOutId);
  assert.deepEqual([eatingOut.spent, eatingOut.limit, eatingOut.status, eatingOut.projected, eatingOut.projected_over_by], [0, 300, "ok", 0, 0]);

  // 16 Feb: 400 spent of 300 -> over; projected 400 ÷ 16 × 28 = 700, over by 400
  eatingOut = buildMonthBudgetProgress("2026-02-16").categories.find((category) => category.category_id === eatingOutId);
  assert.deepEqual([eatingOut.spent, eatingOut.left, eatingOut.status, eatingOut.projected, eatingOut.projected_over_by], [400, -100, "over", 700, 400]);

  // 26 Jan: 150 of 300 = 50% -> ok; projected 150 ÷ 26 × 31 = 178.85, within the limit
  eatingOut = buildMonthBudgetProgress("2026-01-26").categories.find((category) => category.category_id === eatingOutId);
  assert.deepEqual([eatingOut.share_used, eatingOut.status, eatingOut.projected, eatingOut.projected_over_by], [0.5, "ok", 178.85, 0]);

  assert.equal(buildMonthBudgetProgress("2026-02-03").is_early_in_the_month, true);
});

test("near the limit from 80%, over above 100%", async () => {
  const categoryId = await addCategory("Clothes");
  await setBudget(categoryId, 100, "2026-06");
  await addExpense(categoryId, 79.99, "2026-06-02");
  const statusOn = (today) => buildMonthBudgetProgress(today).categories.find((category) => category.category_id === categoryId).status;
  assert.equal(statusOn("2026-06-02"), "ok");
  await addExpense(categoryId, 0.01, "2026-06-03");   // 80.00 = 80%
  assert.equal(statusOn("2026-06-03"), "near");
  await addExpense(categoryId, 20, "2026-06-04");     // 100.00 = exactly the limit: still not over
  assert.equal(statusOn("2026-06-04"), "near");
  await addExpense(categoryId, 0.01, "2026-06-05");   // 100.01
  assert.equal(statusOn("2026-06-05"), "over");
});

test("recurring expenses count like any expense, and the ones still due this month are in the projection", async () => {
  // Rent: 700 € from the dataset's monthly rule (1st of each month); budget 700 from Feb 2026
  await setBudget(dataset.categoryIds.rent, 700, "2026-02");
  const rent = buildMonthBudgetProgress("2026-02-10").categories.find((category) => category.category_id === dataset.categoryIds.rent);
  assert.deepEqual([rent.spent, rent.status, rent.projected, rent.projected_over_by], [700, "near", 700, 0], "at exactly 100%, not over");

  // Gym: 15 € every week from Tue 3 Feb 2026 (3, 10, 17, 24 Feb), budget 50 €.
  // On the 10th: 30 spent (3rd and 10th); still due 17th and 24th = 30; projected 60, over by 10.
  // Recurring spending isn't extrapolated at the daily pace: its dates are known.
  const gymId = await addCategory("Gym");
  await setBudget(gymId, 50, "2026-02");
  const { id: ruleId } = await call("POST", "/recurring-transactions", {
    type: "expense", amount: 15, from_account_id: dataset.accountIds.currentAccount, category_id: gymId,
    repeat_unit: "week", repeat_interval: 1, start_date: "2026-02-03", end_date: "2026-03-31",
  });
  let gym = buildMonthBudgetProgress("2026-02-10").categories.find((category) => category.category_id === gymId);
  assert.deepEqual([gym.spent, gym.status, gym.projected, gym.projected_over_by], [30, "ok", 60, 10]);

  // a paused rule adds nothing more
  const rule = db.prepare(`SELECT * FROM recurring_transactions WHERE id = ?`).get(ruleId);
  await call("PUT", `/recurring-transactions/${ruleId}`, { ...rule, amount: 15, paused: true });
  gym = buildMonthBudgetProgress("2026-02-10").categories.find((category) => category.category_id === gymId);
  assert.equal(gym.projected, 30);
});

test("everything without a budget this month is one unbudgeted total; the budgeted totals add up", () => {
  const progress = buildMonthBudgetProgress("2026-02-28");
  const allExpensesInFebruary = db.prepare(`SELECT SUM(amount) AS total FROM transactions WHERE type = 'expense' AND date BETWEEN '2026-02-01' AND '2026-02-28'`).get().total;
  assert.equal(toCents(progress.total_spent) + toCents(progress.unbudgeted_spent), allExpensesInFebruary);
  const limitsTotal = progress.categories.reduce((sum, category) => sum + toCents(category.limit), 0);
  assert.equal(toCents(progress.total_limit), limitsTotal);
});

test("GET /budgets/this-month answers for today", async () => {
  const progress = await call("GET", "/budgets/this-month");
  assert.equal(progress.month, getTodayAsLocalDate().slice(0, 7));
});

// ---------- category changes and backups ----------

test("merging a category takes its budget away; the category it merges into keeps its own", async () => {
  const typoId = await addCategory("Eatingout");
  await setBudget(typoId, 999, "2026-01");
  await call("PUT", `/categories/${typoId}`, { name: "Eating out", merge: true });
  assert.deepEqual(budgetRows(typoId), []);
  assert.equal(budgetRows(eatingOutId).length, 3);
});

test("a JSON backup keeps the budget history; an older backup without budgets imports with none", async () => {
  const exported = await call("GET", "/export");
  assert.equal(exported.format_version, LATEST_DATABASE_VERSION);
  const rowsBefore = db.prepare(`SELECT * FROM category_budgets ORDER BY category_id, from_month`).all();
  assert.ok(rowsBefore.length > 0);

  await call("POST", "/import", exported);
  assert.deepEqual(db.prepare(`SELECT * FROM category_budgets ORDER BY category_id, from_month`).all(), rowsBefore);
  assert.deepEqual(buildBudgetVsActual("2026-01-20", "2026-03-10").rows.find((row) => row.category_id === eatingOutId).budget, 561.29);

  const { category_budgets: budgets, ...versionTenBackup } = exported;
  await call("POST", "/import", { ...versionTenBackup, format_version: 10 });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM category_budgets`).get().n, 0);
  await call("POST", "/import", exported); // everything back
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM category_budgets`).get().n, budgets.length);
});
