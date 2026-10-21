/* SPENDING PACE OF A CATEGORY (migration 16, PUT /categories/:id/spending-pace)
 * "daily" categories (groceries) have the rest of the month projected at the pace so far; "occasional" ones
 * (rent, gifts) count only what was spent. Checked here: the migration and its starting values, the route,
 * and the two server-side projections that use it (budget bars, category trends). The frontend's "Projected
 * spending" card applies the same rule in frontend/JS/pages/monthProjection.js.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { allMigrationsInOrder, LATEST_DATABASE_VERSION } = require("../backend/db/migrations/allMigrationsInOrder.js");
const { runPendingMigrations } = require("../backend/db/migrations/migrationRunner.js");
const { buildMonthBudgetProgress } = require("../backend/server/services/budgetCalculator.js");
const { buildCategoryTrends } = require("../backend/server/services/categoryTrends.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

// Two categories of their own, so the dataset's other spending can't change the numbers. Same spending in both:
// 100 € on 2 June. On 10 June (day 10 of 30):
//   daily       100 ÷ 10 days × 30 days = 300 € by the end of the month
//   occasional  100 € (nothing guessed on top)
const TODAY = "2026-06-10";
let everydayId, oneOffId;

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
  everydayId = (await call("POST", "/categories", { name: "Pace test everyday", kind: "expense" })).id;
  oneOffId = (await call("POST", "/categories", { name: "Pace test one-off", kind: "expense" })).id;
  for (const categoryId of [everydayId, oneOffId]) {
    await call("PUT", `/categories/${categoryId}/budget`, { monthly_limit: 1000, from_month: "2026-06" });
    await call("POST", "/transactions", { type: "expense", amount: 100, from_account_id: dataset.accountIds.cash, category_id: categoryId, date: "2026-06-02" });
  }
  await call("PUT", `/categories/${oneOffId}/spending-pace`, { spending_pace: "occasional" });
});
after(() => stopServer());

test("migration 16: Rent, Products and Gift start as occasional, everything else as daily", () => {
  const olderDatabase = new Database(":memory:");
  olderDatabase.pragma("foreign_keys = OFF");
  for (let migrationNumber = 1; migrationNumber <= 15; migrationNumber++) allMigrationsInOrder[migrationNumber - 1](olderDatabase);
  olderDatabase.pragma("user_version = 15");
  olderDatabase.pragma("foreign_keys = ON");
  olderDatabase.exec(`INSERT INTO categories (name, kind) VALUES
    ('Rent', 'expense'), ('products', 'expense'), ('Gift', 'expense'), ('Gift', 'income'), ('Grocery', 'expense'), ('Coffee', 'expense')`);
  const originalLog = console.log;
  console.log = () => {};
  try { runPendingMigrations(olderDatabase); } finally { console.log = originalLog; }

  assert.equal(olderDatabase.pragma("user_version", { simple: true }), LATEST_DATABASE_VERSION);
  const paces = olderDatabase.prepare(`SELECT name, kind, spending_pace FROM categories ORDER BY id`).all()
    .map((category) => `${category.name}/${category.kind}: ${category.spending_pace}`);
  assert.deepEqual(paces, [
    "Rent/expense: occasional", "products/expense: occasional", "Gift/expense: occasional",
    "Gift/income: daily", "Grocery/expense: daily", "Coffee/expense: daily",
  ]);
  assert.throws(() => olderDatabase.exec(`UPDATE categories SET spending_pace = 'weekly'`), /CHECK/);
  olderDatabase.exec(`INSERT INTO categories (name, kind) VALUES ('New one', 'expense')`);
  assert.equal(olderDatabase.prepare(`SELECT spending_pace FROM categories WHERE name = 'New one'`).get().spending_pace, "daily", "new categories are daily");
});

test("GET /categories says each category's pace, and the route checks what it's given", async () => {
  const categories = await call("GET", "/categories");
  assert.equal(categories.find((category) => category.id === everydayId).spending_pace, "daily");
  assert.equal(categories.find((category) => category.id === oneOffId).spending_pace, "occasional");

  assert.equal((await callApi("PUT", `/categories/${everydayId}/spending-pace`, { spending_pace: "weekly" })).status, 400);
  assert.equal((await callApi("PUT", `/categories/999999/spending-pace`, { spending_pace: "daily" })).status, 404);
  const incomeId = (await call("POST", "/categories", { name: "Pace test income", kind: "income" })).id;
  assert.equal((await callApi("PUT", `/categories/${incomeId}/spending-pace`, { spending_pace: "occasional" })).status, 400, "income categories have no pace");
});

test("budget bars: a daily category is projected at its pace, an occasional one stays at what's spent", () => {
  const progress = buildMonthBudgetProgress(TODAY);
  const projectedOf = (categoryId) => progress.categories.find((category) => category.category_id === categoryId).projected;
  assert.equal(projectedOf(everydayId), 300);
  assert.equal(projectedOf(oneOffId), 100);
});

test("category trends: the same rule", () => {
  const trends = buildCategoryTrends({ today: TODAY });
  const projectedOf = (categoryId) => trends.categories.find((category) => category.category_id === categoryId).projected;
  // trends add the rest of the month at the pace: 100 + 100 ÷ 10 × 20 = 300
  assert.equal(projectedOf(everydayId), 300);
  assert.equal(projectedOf(oneOffId), 100);
});
