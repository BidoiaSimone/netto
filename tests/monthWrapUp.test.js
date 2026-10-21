/* THE MONTH'S WRAP-UP (services/monthWrapUp.js, routes/monthWrapUpRoutes.js)
 * Its totals are the transactions of the month; it's shown until closed, once; a month before any record has none.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { buildMonthWrapUp, findWrapUpToShow } = require("../backend/server/services/monthWrapUp.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

const sum = (sql, ...params) => db.prepare(sql).get(...params).total;

test("the totals are the month's income and expenses; the categories and the month before match the transactions", () => {
  const wrapUp = buildMonthWrapUp("2026-09", "2026-10-03");
  const income = sum(`SELECT SUM(amount) AS total FROM transactions WHERE type = 'income' AND date LIKE '2026-09%'`);
  const expenses = sum(`SELECT SUM(amount) AS total FROM transactions WHERE type = 'expense' AND date LIKE '2026-09%'`);
  assert.equal(wrapUp.income, income);
  assert.equal(wrapUp.expenses, expenses);
  assert.equal(wrapUp.saved, income - expenses);
  assert.equal(wrapUp.expenses_before, sum(`SELECT SUM(amount) AS total FROM transactions WHERE type = 'expense' AND date LIKE '2026-08%'`));
  assert.equal(wrapUp.is_partial, false);

  const rent = wrapUp.top_categories.find((row) => row.name === "Rent");
  assert.equal(rent.amount, 70000, "the recurring rent");
  assert.ok(wrapUp.top_categories.length <= 3);
  assert.ok(wrapUp.top_categories.every((row, index, rows) => index === 0 || rows[index - 1].amount >= row.amount), "most expensive first");
  assert.notEqual(wrapUp.biggest_expense.category, "Rent", "recurring ones aren't a purchase");
  assert.ok(wrapUp.days_with_entries >= 1 && wrapUp.days_with_entries <= wrapUp.days);
  assert.equal(wrapUp.days, 30);
});

test("a month before any record has no wrap-up; the first one counts from the first record", () => {
  assert.equal(buildMonthWrapUp("2024-12", "2026-10-03"), null);
  const first = buildMonthWrapUp("2025-01", "2026-10-03");
  assert.equal(first.expenses_before, null, "nothing to compare with");
});

test("shown from the 1st until closed, then not again; closing an older month doesn't bring it back", async () => {
  // the real today is used by the route: compare with what the service says for today
  const today = new Date().toLocaleDateString("sv-SE");
  const shown = (await call("GET", "/month-wrap-up")).wrap_up;
  const expected = findWrapUpToShow(today);
  assert.equal(shown?.month ?? null, expected?.month ?? null);

  assert.equal(findWrapUpToShow("2026-10-01").month, "2026-09");
  await call("PUT", "/month-wrap-up/dismiss", { month: "2026-09" });
  assert.equal(findWrapUpToShow("2026-10-20"), null, "closed: not shown again this month");
  assert.equal(findWrapUpToShow("2026-11-01").month, "2026-10", "the next month brings the next one");
  await call("PUT", "/month-wrap-up/dismiss", { month: "2026-05" });
  assert.equal(findWrapUpToShow("2026-10-02"), null, "an older month closed again doesn't reopen September");

  assert.equal((await callApi("PUT", "/month-wrap-up/dismiss", { month: "September" })).status, 400);
  assert.equal((await callApi("GET", "/month-wrap-up?month=2099-01")).status, 400, "only past months");
  assert.equal((await call("GET", "/month-wrap-up?month=2026-09")).wrap_up.month, "2026-09", "a closed one can still be looked at");
  const months = await call("GET", "/month-wrap-up/months");
  assert.equal(months.at(-1), "2025-01", "from the first record's month");
  assert.ok(months[0] < today.slice(0, 7) && months[0] > months[1], "to last month, newest first");
});
