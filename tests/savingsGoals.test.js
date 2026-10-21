/* GOALS PAID FOR BY CUTTING BACK (migration 17, services/savingsGoals.js, routes/savingsGoalRoutes.js)
 * A small dataset of its own, so every number can be worked out by hand:
 *
 *   Coffee: baseline 60 €/month     Food: baseline 90 €/month
 *   "MacBook" 100 €, from 1 March, paid by Coffee + Food      (first in the queue)
 *   "Trip"    500 €, from 1 March, paid by Coffee              (second)
 *
 *   March   Coffee 20, Food 40          MacBook saves (60 − 20) + (90 − 40) = 90
 *   April   Coffee 30, Food 50          MacBook saves 30 + 40 = 70 → 160: full at 100, the 60 above go to Trip
 *   May     (today = 10 May)            MacBook is full, so Coffee now pays for Trip: 60 × 10/31 − 5 spent
 *
 * Trip uses Coffee only, which MacBook takes in March and April: until MacBook is full, Trip gets nothing of its own.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { calculateGoalProgress, suggestBaselines } = require("../backend/server/services/savingsGoals.js");

const db = openTestDatabase();
let callApi, stopServer;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const ids = {};

const TODAY = "2026-05-10";
const byName = (goals, name) => goals.find((goal) => goal.name === name);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  ids.cash = (await call("POST", "/accounts", { name: "Cash", kind: "cash", opening_balance: 5000 })).id;
  db.prepare(`UPDATE accounts SET open_date = '2026-01-01' WHERE id = ?`).run(ids.cash);
  for (const name of ["Coffee", "Food", "Products"]) ids[name] = (await call("POST", "/categories", { name, kind: "expense" })).id;
  const spend = async (categoryName, amount, date) =>
    (await call("POST", "/transactions", { type: "expense", amount, from_account_id: ids.cash, category_id: ids[categoryName], date })).id;
  await spend("Coffee", 20, "2026-03-04");
  await spend("Food", 40, "2026-03-12");
  await spend("Coffee", 30, "2026-04-08");
  await spend("Food", 50, "2026-04-20");
  await spend("Coffee", 5, "2026-05-03");
  await spend("Food", 999, "2026-05-04"); // Food pays for no goal in May (MacBook is full): it must not count anywhere
  ids.feb = await spend("Coffee", 300, "2026-02-15"); // before the goals start: never counted

  ids.macbook = (await call("POST", "/savings-goals", {
    name: "MacBook", target: 100, start_date: "2026-03-01",
    categories: [{ category_id: ids.Coffee, monthly_baseline: 60 }, { category_id: ids.Food, monthly_baseline: 90 }],
  })).id;
  ids.trip = (await call("POST", "/savings-goals", {
    name: "Trip", target: 500, start_date: "2026-03-01", categories: [{ category_id: ids.Coffee, monthly_baseline: 60 }],
  })).id;
});
after(() => stopServer());

test("saved = baseline − spent each month; above the target goes on to the next goal in the queue", () => {
  const goals = calculateGoalProgress(TODAY);
  const macbook = byName(goals, "MacBook"), trip = byName(goals, "Trip");

  assert.equal(macbook.saved, 10000, "90 + 70 = 160, kept at the 100 target");
  assert.equal(macbook.status, "reached");
  assert.deepEqual(macbook.months.map((row) => [row.month, row.saved, row.carried_in]), [["2026-04", 7000, -6000], ["2026-03", 9000, 0]]);

  const mayCoffee = Math.round(6000 * 10 / 31) - 500;
  assert.equal(trip.saved, 6000 + mayCoffee);
  assert.equal(trip.status, "saving");
  assert.deepEqual(trip.months.map((row) => row.month), ["2026-05", "2026-04"]);
  assert.equal(trip.months[1].carried_in, 6000);
  assert.equal(trip.months[0].partial, true, "May so far");
});

test("a month above the baseline counts against the goal", () => {
  // on 10 April: Coffee 30 spent of 20 so far (−10), Food 0 of 30 (+30)
  const macbook = byName(calculateGoalProgress("2026-04-10"), "MacBook");
  assert.equal(macbook.saved, 9000 - 1000 + 3000 - 1000, "110, kept at 100: the other 10 went to Trip");
  const coffee = macbook.categories.find((category) => category.name === "Coffee");
  assert.equal(coffee.saved, (6000 - 2000) + (2000 - 3000), "Coffee was over its baseline in April");
});

test("the purchase is never counted as spending, and says how much cutting back paid for", async () => {
  // the MacBook, bought on 5 May and filed under Coffee: Trip's Coffee savings must not drop
  const before = byName(calculateGoalProgress(TODAY), "Trip").saved;
  // (bought for its target exactly: a different price would move the target, and with it what goes on to Trip)
  const purchaseId = (await call("POST", "/transactions", { type: "expense", amount: 100, from_account_id: ids.cash, category_id: ids.Coffee, date: "2026-05-05", description: "MacBook" })).id;
  await call("PUT", `/savings-goals/${ids.macbook}/purchase`, { transaction_id: purchaseId });

  const goals = calculateGoalProgress(TODAY);
  assert.equal(byName(goals, "Trip").saved, before);
  const macbook = byName(goals, "MacBook");
  assert.equal(macbook.status, "bought");
  assert.equal(macbook.purchase.amount, 10000);
  assert.equal(macbook.purchase.share_paid_by_saving, 1);

  assert.equal((await callApi("PUT", `/savings-goals/${ids.trip}/purchase`, { transaction_id: purchaseId })).status, 409, "one purchase, one goal");
  assert.equal((await callApi("PUT", `/savings-goals/${ids.trip}/purchase`, { transaction_id: 999999 })).status, 404);
  await call("PUT", `/savings-goals/${ids.macbook}/purchase`, { transaction_id: null });
  assert.equal(byName(calculateGoalProgress(TODAY), "MacBook").status, "reached");
  await call("DELETE", `/transactions/${purchaseId}`);
});

test("GET /savings-goals answers in euros, in queue order; reordering changes who gets Coffee first", async () => {
  let goals = await call("GET", "/savings-goals");
  assert.deepEqual(goals.map((goal) => goal.name), ["MacBook", "Trip"]);
  assert.equal(goals[0].target, 100);
  assert.equal(goals[0].categories.find((category) => category.name === "Coffee").monthly_baseline, 60);

  await call("PUT", "/savings-goals/order", { goal_ids: [ids.trip, ids.macbook] });
  const reordered = calculateGoalProgress(TODAY);
  assert.deepEqual(reordered.map((goal) => goal.name), ["Trip", "MacBook"]);
  // Trip now takes Coffee every month; MacBook keeps Food only: (90 − 40) + (90 − 50) + (90 × 10/31 − 999)
  assert.equal(byName(reordered, "MacBook").saved, 5000 + 4000 + Math.round(9000 * 10 / 31) - 99900);
  assert.equal((await callApi("PUT", "/savings-goals/order", { goal_ids: [ids.trip] })).status, 400, "every goal, once");
  await call("PUT", "/savings-goals/order", { goal_ids: [ids.macbook, ids.trip] });
});

test("the goal is checked before it's saved", async () => {
  const valid = { name: "Phone", target: 300, categories: [{ category_id: ids.Coffee, monthly_baseline: 60 }] };
  for (const [change, message] of [
    [{ name: " " }, /name/], [{ target: 0 }, /target/], [{ start_date: "2026-02-30" }, /date/],
    [{ categories: [] }, /category/], [{ categories: [{ category_id: 999999, monthly_baseline: 1 }] }, /expense category/],
    [{ categories: [{ category_id: ids.Coffee, monthly_baseline: 0 }] }, /nothing to cut back/],
    [{ categories: [{ category_id: ids.Coffee, monthly_baseline: 5 }, { category_id: ids.Coffee, monthly_baseline: 5 }] }, /twice/],
  ]) {
    const answer = await callApi("POST", "/savings-goals", { ...valid, ...change });
    assert.equal(answer.status, 400);
    assert.match(answer.body.error, message);
  }
});

test("editing, merging a category, deleting: the queue and the categories stay consistent", async () => {
  await call("PUT", `/savings-goals/${ids.trip}`, { name: "Lisbon trip", target: 400, start_date: "2026-03-01", categories: [{ category_id: ids.Products, monthly_baseline: 30 }] });
  let trip = byName(calculateGoalProgress(TODAY), "Lisbon trip");
  assert.deepEqual(trip.categories.map((category) => category.name), ["Products"]);

  // "Products" merged into "Food": the goal follows the category
  await call("PUT", `/categories/${ids.Products}`, { name: "Food", merge: true });
  trip = byName(calculateGoalProgress(TODAY), "Lisbon trip");
  assert.deepEqual(trip.categories.map((category) => [category.name, category.monthly_baseline]), [["Food", 3000]]);

  const third = (await call("POST", "/savings-goals", { name: "Bike", target: 200, categories: [{ category_id: ids.Coffee, monthly_baseline: 60 }] })).id;
  await call("DELETE", `/savings-goals/${ids.macbook}`);
  const positions = db.prepare(`SELECT id, position FROM savings_goals ORDER BY position`).all();
  assert.deepEqual(positions, [{ id: ids.trip, position: 1 }, { id: third, position: 2 }]);
});

test("suggested baselines: the average of the complete months, goal purchases left out", () => {
  // first record 1 Jan 2026 (the account): on 10 May the complete months are January – April.
  // Coffee: "Bike" uses it, but starts in the future (today, when the test runs): no Coffee month is a goal month
  const suggestion = suggestBaselines(TODAY);
  assert.equal(suggestion.complete_months, 4);
  const coffee = suggestion.categories.find((category) => category.name === "Coffee");
  assert.equal(coffee.monthly_average, Math.round((30000 + 2000 + 3000) / 4));
  assert.deepEqual([coffee.based_on, coffee.months, coffee.skipped_goal_months], ["months", 4, 0]);
});

test("suggested baselines leave out the months a goal was cutting back on that category", () => {
  // "Lisbon trip" (Food, from 1 March): March and April say what Food costs while saving, not normally
  const food = suggestBaselines(TODAY).categories.find((category) => category.name === "Food");
  assert.deepEqual([food.based_on, food.months, food.skipped_goal_months], ["months", 2, 2]);
  assert.equal(food.monthly_average, 0, "January and February: no Food spending");

  // every recorded month a goal month: the goal's own baseline, fixed before the cutting back started
  db.prepare(`UPDATE savings_goals SET start_date = '2026-01-01' WHERE id = ?`).run(ids.trip);
  const onlyGoalMonths = suggestBaselines(TODAY).categories.find((category) => category.name === "Food");
  assert.deepEqual([onlyGoalMonths.based_on, onlyGoalMonths.goal_name, onlyGoalMonths.monthly_average], ["goal", "Lisbon trip", 3000]);
  db.prepare(`UPDATE savings_goals SET start_date = '2026-03-01' WHERE id = ?`).run(ids.trip);
});

test("bought before it's full: the goal keeps collecting after the purchase, paying it back", async () => {
  // Kindle, 50 €, paid by Books (baseline 30 €/month, no books bought), from 1 March; bought on 10 March
  ids.Books = (await call("POST", "/categories", { name: "Books", kind: "expense" })).id;
  const kindle = (await call("POST", "/savings-goals", {
    name: "Kindle", target: 50, start_date: "2026-03-01", categories: [{ category_id: ids.Books, monthly_baseline: 30 }],
  })).id;
  // it cost 60 €, not the 50 planned: the price becomes the target
  const purchaseId = (await call("POST", "/transactions", { type: "expense", amount: 60, from_account_id: ids.cash, category_id: ids.Books, date: "2026-03-10" })).id;
  await call("PUT", `/savings-goals/${kindle}/purchase`, { transaction_id: purchaseId });
  const fromApi = (await call("GET", "/savings-goals")).find((goal) => goal.name === "Kindle");
  assert.deepEqual([fromApi.target, fromApi.planned_target], [60, 50]);

  // 10 April: March (30) + 10 days of April (30 × 10/30): not paid back yet, and the purchase isn't Books spending
  const halfway = byName(calculateGoalProgress("2026-04-10"), "Kindle");
  assert.equal(halfway.status, "paying_back");
  assert.equal(halfway.saved, 3000 + Math.round(3000 * 10 / 30));
  assert.ok(halfway.monthly_pace > 0 && halfway.months_to_go > 0);

  // 10 May: full at the end of April (30 + 30 = 60, the price) → bought, all paid back
  const paid = byName(calculateGoalProgress(TODAY), "Kindle");
  assert.equal(paid.status, "bought");
  assert.equal(paid.purchase.share_paid_by_saving, 1);
  assert.deepEqual(paid.months.map((row) => row.month), ["2026-04", "2026-03"], "it stopped collecting once full");

  // unlinked (a wrong pick): the planned target comes back
  await call("PUT", `/savings-goals/${kindle}/purchase`, { transaction_id: null });
  assert.equal(byName(calculateGoalProgress(TODAY), "Kindle").target, 5000);
});
