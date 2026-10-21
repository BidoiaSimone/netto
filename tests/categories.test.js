/* CATEGORIES (backend/server/routes/categoryRoutes.js): rename, merge, move to the other kind.
 * Everything refers to a category by id, so none of these may lose a transaction's category.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

const countTransactionsOfCategory = (categoryId) => db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?`).get(categoryId).n;
const findCategory = (categoryId) => db.prepare(`SELECT id, name, kind FROM categories WHERE id = ?`).get(categoryId);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

test("renaming keeps the id, the kind and every transaction", async () => {
  const { groceries } = dataset.categoryIds;
  const usesBefore = countTransactionsOfCategory(groceries);
  assert.ok(usesBefore > 0);

  await call("PUT", `/categories/${groceries}`, { name: "  Food   and groceries " });
  assert.deepEqual(findCategory(groceries), { id: groceries, name: "Food and groceries", kind: "expense" }); // spaces cleaned
  assert.equal(countTransactionsOfCategory(groceries), usesBefore);

  // changing only the capitalisation is allowed: it's the same category
  await call("PUT", `/categories/${groceries}`, { name: "food and groceries" });
  assert.equal(findCategory(groceries).name, "food and groceries");
});

test("renaming to a name that exists in the same kind asks first, then merges", async () => {
  const { id: typoId } = await call("POST", "/categories", { name: "Grocerie", kind: "expense" });
  await call("POST", "/transactions", { type: "expense", amount: 3, from_account_id: dataset.accountIds.cash, category_id: typoId });
  await call("POST", "/recurring-transactions", {
    type: "expense", amount: 3, from_account_id: dataset.accountIds.cash, category_id: typoId,
    repeat_unit: "month", start_date: "2030-01-01", // in the future: adds nothing yet
  });
  const { rent } = dataset.categoryIds;
  const rentUsesBefore = countTransactionsOfCategory(rent);

  const firstAnswer = await callApi("PUT", `/categories/${typoId}`, { name: "RENT" });
  assert.equal(firstAnswer.status, 409);
  assert.equal(firstAnswer.body.merge_into.id, rent);
  assert.ok(findCategory(typoId), "nothing merged before confirming");

  const merged = await call("PUT", `/categories/${typoId}`, { name: "RENT", merge: true });
  assert.equal(merged.merged_into.id, rent);
  assert.equal(findCategory(typoId), undefined, "the merged category is gone");
  assert.equal(countTransactionsOfCategory(rent), rentUsesBefore + 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM recurring_transactions WHERE category_id = ?`).get(typoId).n, 0);
});

test("the same name may exist once per kind, and renaming never crosses kinds", async () => {
  assert.equal(findCategory(dataset.categoryIds.giftReceived).name, "Gift");
  assert.equal(findCategory(dataset.categoryIds.giftGiven).name, "Gift");
  const duplicate = await callApi("POST", "/categories", { name: "gift", kind: "expense" });
  assert.equal(duplicate.status, 409);

  // an income category renamed to "Rent", which only exists as an expense: no merge, just a rename
  const { id: bonusId } = await call("POST", "/categories", { name: "Bonus", kind: "income" });
  const renamed = await call("PUT", `/categories/${bonusId}`, { name: "Rent" });
  assert.deepEqual(renamed, { id: bonusId, name: "Rent", kind: "income" });
});

test("moving to the other kind is blocked while incomes or expenses of the old kind use it", async () => {
  const { rent } = dataset.categoryIds; // used by expenses and by the recurring rent rule
  const response = await callApi("PUT", `/categories/${rent}/kind`, { kind: "income" });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /used by \d+ expenses/);
  assert.equal(findCategory(rent).kind, "expense");
});

test("a recurring rule alone also blocks the move", async () => {
  const { id: categoryId } = await call("POST", "/categories", { name: "Gym", kind: "expense" });
  await call("POST", "/recurring-transactions", {
    type: "expense", amount: 30, from_account_id: dataset.accountIds.currentAccount, category_id: categoryId,
    repeat_unit: "month", start_date: "2030-01-01",
  });
  const response = await callApi("PUT", `/categories/${categoryId}/kind`, { kind: "income" });
  assert.equal(response.status, 409);
});

test("used only by movements, a category can move; incomes can then use it", async () => {
  const { id: categoryId } = await call("POST", "/categories", { name: "Pension fund", kind: "expense" });
  await call("POST", "/transactions", { type: "movement", amount: 10, from_account_id: dataset.accountIds.currentAccount, to_account_id: dataset.accountIds.savings, category_id: categoryId });

  const moved = await call("PUT", `/categories/${categoryId}/kind`, { kind: "income" });
  assert.equal(moved.kind, "income");
  assert.equal(countTransactionsOfCategory(categoryId), 1, "the movement keeps its category");

  const income = await callApi("POST", "/transactions", { type: "income", amount: 10, to_account_id: dataset.accountIds.savings, category_id: categoryId });
  assert.equal(income.status, 201);
  const expense = await callApi("POST", "/transactions", { type: "expense", amount: 10, from_account_id: dataset.accountIds.savings, category_id: categoryId });
  assert.equal(expense.status, 400);
});

test("once its expenses use another category, it can move", async () => {
  const { id: categoryId } = await call("POST", "/categories", { name: "INPS refund", kind: "expense" });
  const { id: transactionId } = await call("POST", "/transactions", { type: "expense", amount: 4, from_account_id: dataset.accountIds.cash, category_id: categoryId, date: "2026-02-02" });
  assert.equal((await callApi("PUT", `/categories/${categoryId}/kind`, { kind: "income" })).status, 409);

  await call("PUT", `/transactions/${transactionId}`, { type: "expense", amount: 4, from_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.rent, date: "2026-02-02" });
  assert.equal((await call("PUT", `/categories/${categoryId}/kind`, { kind: "income" })).kind, "income");
});

test("moving is refused when the other kind already has that name", async () => {
  const { id: categoryId } = await call("POST", "/categories", { name: "Salary", kind: "expense" }); // unused
  const response = await callApi("PUT", `/categories/${categoryId}/kind`, { kind: "income" });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /already exists among the income categories/);
});

test("deleting a category leaves its transactions uncategorized, not deleted", async () => {
  const { refund } = dataset.categoryIds;
  const transactionIds = db.prepare(`SELECT id FROM transactions WHERE category_id = ?`).all(refund).map((row) => row.id);
  assert.ok(transactionIds.length > 0);
  await call("DELETE", `/categories/${refund}`);
  for (const transactionId of transactionIds) {
    assert.equal(db.prepare(`SELECT category_id FROM transactions WHERE id = ?`).get(transactionId).category_id, null);
  }
});

// ---- icon and colour (migration 21) ----

test("a new category can be given an icon and a colour, and the list returns them", async () => {
  const created = await call("POST", "/categories", { name: "Pharmacy", kind: "expense", icon: "pills", color: "#D6408A" });
  assert.equal(created.icon, "pills");
  assert.equal(created.color, "#d6408a", "colours are kept in lowercase");
  const listed = (await call("GET", "/categories")).find((category) => category.id === created.id);
  assert.equal(listed.icon, "pills");
  assert.equal(listed.color, "#d6408a");

  // without them: both null, so the lists show the initial on a guessed colour
  const plain = await call("POST", "/categories", { name: "Books", kind: "expense" });
  assert.equal(plain.icon, null);
  assert.equal(plain.color, null);
});

test("the look can be changed and cleared, and badly formed ones are refused", async () => {
  const { groceries } = dataset.categoryIds;
  const usesBefore = countTransactionsOfCategory(groceries);

  const changed = await call("PUT", `/categories/${groceries}/look`, { icon: "cart", color: "#2f9e44" });
  assert.deepEqual([changed.icon, changed.color], ["cart", "#2f9e44"]);
  assert.equal(countTransactionsOfCategory(groceries), usesBefore, "nothing else changes");

  for (const badLook of [{ icon: "Cart!", color: "#2f9e44" }, { icon: "cart", color: "green" }, { icon: "cart", color: "#2f9e4" }, { icon: 3 }]) {
    assert.equal((await callApi("PUT", `/categories/${groceries}/look`, badLook)).status, 400, JSON.stringify(badLook));
    assert.equal((await callApi("POST", "/categories", { name: "Bad look", kind: "expense", ...badLook })).status, 400, JSON.stringify(badLook));
  }
  const stored = db.prepare(`SELECT icon, color FROM categories WHERE id = ?`).get(groceries);
  assert.deepEqual({ ...stored }, { icon: "cart", color: "#2f9e44" }, "a refused change leaves the old look");

  const cleared = await call("PUT", `/categories/${groceries}/look`, { icon: null, color: "" });
  assert.deepEqual([cleared.icon, cleared.color], [null, null]);
  assert.equal((await callApi("PUT", "/categories/999999/look", { icon: "cart" })).status, 404);
});

test("renaming keeps the look", async () => {
  const { transport } = dataset.categoryIds;
  await call("PUT", `/categories/${transport}/look`, { icon: "bus", color: "#3478f6" });
  await call("PUT", `/categories/${transport}`, { name: "Public transport" });
  const stored = db.prepare(`SELECT name, icon, color FROM categories WHERE id = ?`).get(transport);
  assert.deepEqual({ ...stored }, { name: "Public transport", icon: "bus", color: "#3478f6" });
});
