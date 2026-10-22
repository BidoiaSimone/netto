/* INCOME LINKED TO A GOAL (migration 22, services/savingsGoals.js, routes/savingsGoalRoutes.js)
 * Selling the old MacBook pays for part of the new one. A dataset of its own, every number worked out by hand:
 *
 *   Coffee: baseline 60 €/month
 *   "MacBook" 1.660 €, from 1 March, paid by Coffee     (first in the queue)
 *   "Trip"      500 €, from 1 March, paid by Coffee     (second: waits for Coffee until MacBook is full)
 *
 *   March   Coffee 20 spent                    MacBook saves 60 − 20 = 40 by cutting back
 *           15 March: old MacBook sold, 400 €  linked to MacBook → 440
 *           16 March: a refund, 50 €            not linked: counts toward no goal
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { calculateGoalProgress } = require("../backend/server/services/savingsGoals.js");
const { buildFullJsonBackup } = require("../backend/server/services/jsonBackupExport.js");
const { replaceAllDataWithBackup } = require("../backend/server/services/jsonBackupImport.js");

const db = openTestDatabase();
let callApi, stopServer;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const ids = {};

const TODAY = "2026-03-31";
const byName = (goals, name) => goals.find((goal) => goal.name === name);
const linkedGoalOf = (transactionId) => db.prepare(`SELECT goal_id FROM savings_goal_incomes WHERE transaction_id = ?`).get(transactionId)?.goal_id ?? null;
const income = async (amount, date, description) =>
  (await call("POST", "/transactions", { type: "income", amount, to_account_id: ids.cash, category_id: ids.Sold, date, description })).id;
const link = (goalId, transactionId) => call("POST", `/savings-goals/${goalId}/incomes`, { transaction_id: transactionId });

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  ids.cash = (await call("POST", "/accounts", { name: "Cash", kind: "cash", opening_balance: 1000 })).id;
  db.prepare(`UPDATE accounts SET open_date = '2026-01-01' WHERE id = ?`).run(ids.cash);
  ids.Coffee = (await call("POST", "/categories", { name: "Coffee", kind: "expense" })).id;
  ids.Products = (await call("POST", "/categories", { name: "Products", kind: "expense" })).id;
  ids.Sold = (await call("POST", "/categories", { name: "Sold stuff", kind: "income" })).id;

  ids.macbook = (await call("POST", "/savings-goals", {
    name: "MacBook", target: 1660, start_date: "2026-03-01", categories: [{ category_id: ids.Coffee, monthly_baseline: 60 }],
  })).id;
  ids.trip = (await call("POST", "/savings-goals", {
    name: "Trip", target: 500, start_date: "2026-03-01", categories: [{ category_id: ids.Coffee, monthly_baseline: 60 }],
  })).id;

  await call("POST", "/transactions", { type: "expense", amount: 20, from_account_id: ids.cash, category_id: ids.Coffee, date: "2026-03-04" });
  ids.oldMacbookSold = await income(400, "2026-03-15", "Old MacBook");
  await link(ids.macbook, ids.oldMacbookSold);
  ids.refund = await income(50, "2026-03-16", "Refund");
});
after(() => stopServer());

test("a linked income goes to its goal on top of the cutting back; one not linked goes nowhere", () => {
  const goals = calculateGoalProgress(TODAY);
  const macbook = byName(goals, "MacBook");
  assert.equal(macbook.saved, 4000 + 40000);
  assert.equal(macbook.income_total, 40000);
  assert.deepEqual(macbook.incomes.map((row) => [row.transaction_id, row.amount, row.description]), [[ids.oldMacbookSold, 40000, "Old MacBook"]]);
  assert.deepEqual(macbook.months.map((row) => [row.month, row.saved, row.income]), [["2026-03", 4000, 40000]]);
  assert.equal(macbook.status, "saving");
  assert.equal(byName(goals, "Trip").saved, 0, "the refund isn't linked: it counts toward no goal");
});

test("the pace is the cutting back only: a one-off sale says nothing about the months ahead", () => {
  const macbook = byName(calculateGoalProgress(TODAY), "MacBook");
  const pace = Math.round((4000 / 31) * (365.25 / 12));
  assert.equal(macbook.monthly_pace, pace);
  assert.equal(macbook.months_to_go, (166000 - 44000) / pace);
});

test("a linked income is still an ordinary income: the account has it", () => {
  const balance = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(ids.cash).balance;
  assert.equal(balance, 100000 - 2000 + 40000 + 5000);
});

test("GET /savings-goals answers in euros", async () => {
  const macbook = (await call("GET", "/savings-goals")).find((goal) => goal.name === "MacBook");
  assert.equal(macbook.income_total, 400);
  assert.equal(macbook.incomes[0].amount, 400);
  assert.equal(macbook.months.find((row) => row.month === "2026-03").income, 400); // newest first: today is later
});

test("bought: how much of the price the cutting back paid, and how much the income", async () => {
  const purchaseId = (await call("POST", "/transactions", { type: "expense", amount: 1660, from_account_id: ids.cash, category_id: ids.Products, date: "2026-03-20" })).id;
  await call("PUT", `/savings-goals/${ids.macbook}/purchase`, { transaction_id: purchaseId });
  const macbook = byName(calculateGoalProgress(TODAY), "MacBook");
  assert.equal(macbook.status, "paying_back");
  assert.equal(macbook.purchase.share_paid_by_income, 40000 / 166000);
  assert.equal(macbook.purchase.share_paid_by_saving, 4000 / 166000);
  await call("PUT", `/savings-goals/${ids.macbook}/purchase`, { transaction_id: null });
  await call("DELETE", `/transactions/${purchaseId}`);
});

test("income that takes a goal above its target: the extra goes on to the next goal in the queue", async () => {
  const bigSaleId = await income(1300, "2026-03-20", "Old bike");
  await link(ids.macbook, bigSaleId);
  const goals = calculateGoalProgress(TODAY);
  const macbook = byName(goals, "MacBook"), trip = byName(goals, "Trip");
  // 40 + 400 + 1300 = 1740: 80 above the 1660
  assert.equal(macbook.saved, 166000);
  assert.equal(macbook.status, "reached");
  assert.equal(macbook.months[0].carried_in, -8000);
  assert.equal(trip.saved, 8000);
  assert.equal(trip.months[0].carried_in, 8000);
  await call("DELETE", `/transactions/${bigSaleId}`);
  assert.equal(linkedGoalOf(bigSaleId), null, "deleting the income removes the link");
});

test("only an income can be linked, to one goal at most; unlinking keeps the income", async () => {
  const expenseId = (await call("POST", "/transactions", { type: "expense", amount: 5, from_account_id: ids.cash, category_id: ids.Coffee, date: "2026-03-21" })).id;
  const refused = await callApi("POST", `/savings-goals/${ids.macbook}/incomes`, { transaction_id: expenseId });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /income/);
  await call("DELETE", `/transactions/${expenseId}`);
  assert.equal((await callApi("POST", `/savings-goals/999999/incomes`, { transaction_id: ids.refund })).status, 404);
  assert.equal((await callApi("POST", `/savings-goals/${ids.trip}/incomes`, { transaction_id: 999999 })).status, 404);

  const saleId = await income(30, "2026-03-22", "Old phone");
  await link(ids.trip, saleId);
  await link(ids.macbook, saleId); // linked again elsewhere: moved, not counted twice
  assert.equal(linkedGoalOf(saleId), ids.macbook);
  assert.equal((await callApi("DELETE", `/savings-goals/${ids.trip}/incomes/${saleId}`)).status, 404, "not in Trip any more");
  await call("DELETE", `/savings-goals/${ids.macbook}/incomes/${saleId}`);
  assert.equal(linkedGoalOf(saleId), null);
  assert.ok(db.prepare(`SELECT id FROM transactions WHERE id = ?`).get(saleId), "the income itself stays");
  await call("DELETE", `/transactions/${saleId}`);
});

test("editing a linked income keeps the link; turning it into an expense removes it", async () => {
  const saleId = await income(30, "2026-03-22", "Old phone");
  await link(ids.trip, saleId);
  const edit = (body) => call("PUT", `/transactions/${saleId}`, { amount: 35, date: "2026-03-22", ...body });
  await edit({ type: "income", to_account_id: ids.cash, category_id: ids.Sold, description: "Old phone, sold for more" });
  assert.equal(linkedGoalOf(saleId), ids.trip);
  await edit({ type: "expense", from_account_id: ids.cash, category_id: ids.Coffee });
  assert.equal(linkedGoalOf(saleId), null);
  await call("DELETE", `/transactions/${saleId}`);
});

test("the links go into the JSON backup and come back with it", () => {
  const backup = buildFullJsonBackup();
  assert.deepEqual(backup.savings_goal_incomes, [{ transaction_id: ids.oldMacbookSold, goal_id: ids.macbook }]);
  replaceAllDataWithBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(linkedGoalOf(ids.oldMacbookSold), ids.macbook);
  assert.equal(byName(calculateGoalProgress(TODAY), "MacBook").income_total, 40000);
});

test("deleting the goal removes the link; the income stays", async () => {
  await call("DELETE", `/savings-goals/${ids.macbook}`);
  assert.equal(linkedGoalOf(ids.oldMacbookSold), null);
  assert.ok(db.prepare(`SELECT id FROM transactions WHERE id = ?`).get(ids.oldMacbookSold));
});
