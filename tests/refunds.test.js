/* REFUNDS (migration 23): an income can name the expense category it pays back, and every total then counts it
 * as less spending in that category instead of as income. A dataset of its own, every number worked out by hand:
 *
 *   Cash, opening 500 €. Goal "Bike" 300 €, from 1 September, paid by Food (baseline 100 €/month). Food budget 50 €.
 *
 *   1 Sep    Salary 1.000 €                       income
 *   10 Sep   Dinner 55 € (Food), tag "Dinner"     expense
 *   12 Sep   A friend pays back 25 €, tag "Dinner"  income, Refunds, pays back Food
 *   13 Sep   Another refund, 10 €                  income, Refunds, pays back nothing: an ordinary income
 *
 *   Food spent in September: 55 − 25 = 30 €. Income: 1.000 + 10 = 1.010 €. Cash: 500 + 1.000 − 55 + 25 + 10 = 1.480 €.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { calculateGoalProgress } = require("../backend/server/services/savingsGoals.js");
const { buildMonthWrapUp } = require("../backend/server/services/monthWrapUp.js");
const { buildBudgetVsActual } = require("../backend/server/services/budgetCalculator.js");
const { buildTagReport } = require("../backend/server/services/tagReport.js");
const { buildFullJsonBackup } = require("../backend/server/services/jsonBackupExport.js");
const { replaceAllDataWithBackup } = require("../backend/server/services/jsonBackupImport.js");

const db = openTestDatabase();
let callApi, stopServer;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const ids = {};

const refundOf = (transactionId) => db.prepare(`SELECT refund_category_id FROM transactions WHERE id = ?`).get(transactionId).refund_category_id;

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  ids.cash = (await call("POST", "/accounts", { name: "Cash", kind: "cash", opening_balance: 500 })).id;
  db.prepare(`UPDATE accounts SET open_date = '2026-09-01' WHERE id = ?`).run(ids.cash);
  ids.Food = (await call("POST", "/categories", { name: "Food", kind: "expense" })).id;
  ids.Salary = (await call("POST", "/categories", { name: "Salary", kind: "income" })).id;
  ids.Refunds = (await call("POST", "/categories", { name: "Refunds", kind: "income" })).id;
  await call("PUT", `/categories/${ids.Food}/budget`, { monthly_limit: 50, from_month: "2026-09" });
  await call("POST", "/savings-goals", { name: "Bike", target: 300, start_date: "2026-09-01", categories: [{ category_id: ids.Food, monthly_baseline: 100 }] });

  const add = async (transaction) => (await call("POST", "/transactions", transaction)).id;
  await add({ type: "income", amount: 1000, to_account_id: ids.cash, category_id: ids.Salary, date: "2026-09-01" });
  ids.dinner = await add({ type: "expense", amount: 55, from_account_id: ids.cash, category_id: ids.Food, date: "2026-09-10", new_tag_names: ["Dinner"] });
  ids.dinnerTag = db.prepare(`SELECT id FROM tags WHERE name = 'Dinner'`).get().id;
  ids.refund = await add({ type: "income", amount: 25, to_account_id: ids.cash, category_id: ids.Refunds, refund_category_id: ids.Food,
    date: "2026-09-12", tag_ids: [ids.dinnerTag] });
  ids.plainRefund = await add({ type: "income", amount: 10, to_account_id: ids.cash, category_id: ids.Refunds, date: "2026-09-13" });
});
after(() => stopServer());

test("a refund is saved with the category it pays back, and the list names it", async () => {
  assert.equal(refundOf(ids.refund), ids.Food);
  assert.equal(refundOf(ids.plainRefund), null);
  const { body: transactions } = await callApi("GET", "/transactions");
  const refund = transactions.find((transaction) => transaction.id === ids.refund);
  assert.equal(refund.refund_category, "Food");
  assert.equal(refund.category, "Refunds");
});

test("the account still gets the money: a refund is an income for the balance", () => {
  assert.equal(db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(ids.cash).balance, 148000);
});

test("a goal counts the refund as less spending in its category", () => {
  const bike = calculateGoalProgress("2026-09-30").find((goal) => goal.name === "Bike");
  assert.equal(bike.months[0].spent, 3000);  // 55 − 25
  assert.equal(bike.months[0].saved, 7000);  // 100 − 30
  assert.equal(bike.saved, 7000);
});

test("the wrap-up, the budgets and the statements take it off Food, not add it to income", async () => {
  const wrapUp = buildMonthWrapUp("2026-09", "2026-10-05");
  assert.equal(wrapUp.income, 101000);   // the salary and the refund that pays back nothing
  assert.equal(wrapUp.expenses, 3000);
  assert.equal(wrapUp.saved, 98000);     // the same as without refunds: only where it's counted changes
  assert.deepEqual(wrapUp.top_categories.map((row) => [row.name, row.amount]), [["Food", 3000]]);

  const food = buildBudgetVsActual("2026-09-01", "2026-09-30").rows.find((row) => row.category_id === ids.Food);
  assert.equal(food.actual, 30);

  const { body: statements } = await callApi("GET", "/statements?from=2026-09-01&to=2026-09-30");
  const statement = statements.income_statement;
  assert.equal(statement.total_income, 1010);
  assert.equal(statement.total_expenses, 30);
});

test("the tag report: the refund comes off what the dinner cost", () => {
  const dinner = buildTagReport().find((tag) => tag.name === "Dinner");
  assert.equal(dinner.transaction_count, 2);
  assert.equal(dinner.spent, 30);
  assert.equal(dinner.received, 0);
  assert.deepEqual(dinner.expenses_by_category.map((row) => [row.name, row.total]), [["Food", 30]]);
});

test("only an income can be a refund, and only of an expense category", async () => {
  const intoIncomeCategory = await callApi("POST", "/transactions", {
    type: "income", amount: 5, to_account_id: ids.cash, category_id: ids.Refunds, refund_category_id: ids.Salary, date: "2026-09-14" });
  assert.equal(intoIncomeCategory.status, 400);
  assert.match(intoIncomeCategory.body.error, /income category/);

  const unknown = await callApi("POST", "/transactions", {
    type: "income", amount: 5, to_account_id: ids.cash, refund_category_id: 9999, date: "2026-09-14" });
  assert.equal(unknown.status, 400);

  const expense = await call("POST", "/transactions", {
    type: "expense", amount: 5, from_account_id: ids.cash, category_id: ids.Food, refund_category_id: ids.Food, date: "2026-09-14" });
  assert.equal(refundOf(expense.id), null, "an expense never has one");
  await call("DELETE", `/transactions/${expense.id}`);
});

test("a refund can't also pay into a goal; becoming one unlinks it", async () => {
  const bikeId = db.prepare(`SELECT id FROM savings_goals WHERE name = 'Bike'`).get().id;
  const refused = await callApi("POST", `/savings-goals/${bikeId}/incomes`, { transaction_id: ids.refund });
  assert.equal(refused.status, 400);

  await call("POST", `/savings-goals/${bikeId}/incomes`, { transaction_id: ids.plainRefund });
  await call("PUT", `/transactions/${ids.plainRefund}`, {
    type: "income", amount: 10, to_account_id: ids.cash, category_id: ids.Refunds, refund_category_id: ids.Food, date: "2026-09-13" });
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM savings_goal_incomes`).get().count, 0);
  assert.equal(refundOf(ids.plainRefund), ids.Food);

  // and back to an ordinary income: the edit sends no refund category
  await call("PUT", `/transactions/${ids.plainRefund}`, {
    type: "income", amount: 10, to_account_id: ids.cash, category_id: ids.Refunds, date: "2026-09-13" });
  assert.equal(refundOf(ids.plainRefund), null);
});

test("a backup keeps which category each refund pays back", () => {
  const backup = buildFullJsonBackup();
  replaceAllDataWithBackup(backup);
  assert.equal(refundOf(ids.refund), ids.Food);
  assert.equal(refundOf(ids.plainRefund), null);
});

test("merging a category moves its refunds; deleting it makes them ordinary income", async () => {
  ids.Dinners = (await call("POST", "/categories", { name: "Dinners", kind: "expense" })).id;
  const refund = (await call("POST", "/transactions", {
    type: "income", amount: 5, to_account_id: ids.cash, category_id: ids.Refunds, refund_category_id: ids.Dinners, date: "2026-09-20" })).id;

  const moveToIncome = await callApi("PUT", `/categories/${ids.Dinners}/kind`, { kind: "income" });
  assert.equal(moveToIncome.status, 409, "a refund needs an expense category");

  await call("PUT", `/categories/${ids.Dinners}`, { name: "Food", merge: true });
  assert.equal(refundOf(refund), ids.Food);

  await call("DELETE", `/categories/${ids.Food}`);
  assert.equal(refundOf(refund), null);
  assert.equal(refundOf(ids.refund), null);
});
