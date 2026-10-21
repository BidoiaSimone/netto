/* CATEGORY TRENDS (Insights): this month against the usual average of the complete months before it.
 * Most tests pass their own "today" to buildCategoryTrends, so the numbers don't depend on the day the tests run.
 * The fake dataset starts on 1 Jan 2025, so January 2025 is the first complete month.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { buildCategoryTrends, addMonthsToYearMonth } = require("../backend/server/services/categoryTrends.js");
const { readAllSettings } = require("../backend/server/services/appSettings.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const findCategory = (trends, name) => trends.categories.find((category) => category.name === name);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

test("with fewer than 6 complete months, the average uses the ones there are, and says how many", () => {
  const trends = buildCategoryTrends({ today: "2025-04-15" });
  assert.equal(trends.months_in_average, 3);
  assert.deepEqual(trends.average_months, ["2025-01", "2025-02", "2025-03"]);
  const groceries = findCategory(trends, "Groceries");
  // Jan 87,30 + 151,25 · Feb 90,47 + 151,25 · Mar 93,64 + 151,25 (current account + meal vouchers)
  assert.equal(groceries.average, 241.72);
  assert.equal(groceries.last_month, 244.89);
  // April so far: 96,81 € on the 10th (the vouchers' 151,25 come on the 20th); at that pace for 30 days: 193,62 €
  assert.equal(groceries.this_month, 96.81);
  assert.equal(groceries.projected, 193.62);
  assert.equal(groceries.is_running_hot, false);
  assert.equal(groceries.sparkline.length, 12);
  assert.deepEqual(groceries.sparkline.slice(-4).map((point) => point.total), [238.55, 241.72, 244.89, 96.81]);
});

test("a trip (a tag with dates) is left out of the usual average, unless the setting says otherwise", () => {
  // Lisbon, 10–14 Sep 2025: train 64,90 + tram 12,10 (Transport), groceries 23,45. The 6 months before October 2025: Apr–Sep.
  const withTripsLeftOut = buildCategoryTrends({ today: "2025-10-15" });
  assert.equal(withTripsLeftOut.excluding_trips, true);
  assert.equal(withTripsLeftOut.trip_spending_left_out, 100.45);
  assert.equal(findCategory(withTripsLeftOut, "Transport").average, 0);
  assert.equal(findCategory(withTripsLeftOut, "Transport").last_month, 77, "last month still shows everything spent");

  const withTrips = buildCategoryTrends({ today: "2025-10-15", settings: { ...readAllSettings(), trend_exclude_trips: 0 } });
  assert.equal(withTrips.excluding_trips, false);
  assert.equal(findCategory(withTrips, "Transport").average, 12.83); // 77 / 6
  assert.ok(findCategory(withTrips, "Groceries").average > findCategory(withTripsLeftOut, "Groceries").average);

  // "Work" has no dates: it's a label, not a trip, and leaves nothing out on its own (its one transaction is also in Lisbon)
  db.prepare(`UPDATE tags SET start_date = NULL, end_date = NULL WHERE id = ?`).run(dataset.tagIds.lisbon);
  assert.equal(buildCategoryTrends({ today: "2025-10-15" }).trip_spending_left_out, 0);
  db.prepare(`UPDATE tags SET start_date = '2025-09-10', end_date = '2025-09-14' WHERE id = ?`).run(dataset.tagIds.lisbon);
});

test("running hot needs both the share and the amount: a big category over its usual is flagged, a tiny one isn't", async () => {
  const books = (await call("POST", "/categories", { name: "Books", kind: "expense" })).id;
  const coffee = (await call("POST", "/categories", { name: "Coffee beans", kind: "expense" })).id;
  const { cash } = dataset.accountIds;
  for (let monthsBack = 1; monthsBack <= 6; monthsBack++) {
    const month = addMonthsToYearMonth("2026-08", -monthsBack);
    await call("POST", "/transactions", { type: "expense", amount: 50, from_account_id: cash, category_id: books, date: `${month}-12` });
    await call("POST", "/transactions", { type: "expense", amount: 4, from_account_id: cash, category_id: coffee, date: `${month}-12` });
  }
  await call("POST", "/transactions", { type: "expense", amount: 90, from_account_id: cash, category_id: books, date: "2026-08-02" });
  await call("POST", "/transactions", { type: "expense", amount: 8, from_account_id: cash, category_id: coffee, date: "2026-08-02" });

  const trends = buildCategoryTrends({ today: "2026-08-20" });
  const booksTrend = findCategory(trends, "Books");
  assert.equal(booksTrend.average, 50);
  assert.equal(booksTrend.projected, 139.5);  // 90 so far + 90 / 20 days × 11 days left
  assert.equal(booksTrend.difference, 89.5);
  assert.equal(booksTrend.is_running_hot, true);
  const firstNotHot = trends.categories.findIndex((category) => !category.is_running_hot);
  assert.ok(trends.categories.slice(firstNotHot).every((category) => !category.is_running_hot), "running hot comes first");

  const coffeeTrend = findCategory(trends, "Coffee beans");
  assert.equal(coffeeTrend.projected, 12.4);  // +210%, but only 8,40 € more
  assert.equal(coffeeTrend.is_running_hot, false);
  const coffeeWithLowerAmount = buildCategoryTrends({ today: "2026-08-20", settings: { ...readAllSettings(), trend_highlight_minimum_euros: 5 } });
  assert.equal(findCategory(coffeeWithLowerAmount, "Coffee beans").is_running_hot, true);
  const booksWithHigherShare = buildCategoryTrends({ today: "2026-08-20", settings: { ...readAllSettings(), trend_highlight_share: 2 } });
  assert.equal(findCategory(booksWithHigherShare, "Books").is_running_hot, false, "+179% isn't above +200%");
});

test("this month's projection includes the recurring expenses still due, without a daily pace on them", async () => {
  const gym = (await call("POST", "/categories", { name: "Gym", kind: "expense" })).id;
  const today = new Date().toLocaleDateString("sv-SE");
  const [year, month] = today.split("-").map(Number);
  const lastDayOfMonth = `${today.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  await call("POST", "/recurring-transactions", {
    type: "expense", amount: 39.9, from_account_id: dataset.accountIds.currentAccount, category_id: gym,
    repeat_unit: "month", repeat_interval: 1, start_date: lastDayOfMonth,
  });
  const trends = await call("GET", "/insights/category-trends");
  const gymTrend = findCategory(trends, "Gym");
  assert.equal(gymTrend.projected, 39.9, "due later this month (or added today if today is the last day): counted once");
  assert.equal(gymTrend.average, 0);
  assert.equal(gymTrend.is_running_hot, true, "from nothing to 39,90 €: above the usual by more than 25% and 20 €");
});

test("no complete month yet: no average, nothing flagged", () => {
  const trends = buildCategoryTrends({ today: "2025-01-20" });
  assert.equal(trends.months_in_average, 0);
  assert.ok(trends.categories.every((category) => category.average === null && !category.is_running_hot));
});
