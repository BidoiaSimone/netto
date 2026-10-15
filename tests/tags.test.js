/* TAGS (migration 10, routes/tagRoutes.js, services/transactionTags.js, services/tagReport.js)
 * A tag groups transactions across categories, e.g. a trip. Checked here: the migration, setting a
 * transaction's tags, renaming / merging / deleting tags, what each tag adds up to, and JSON backups.
 *
 * The shared dataset has a trip, "Lisbon 2025" (see helpers/fakeDataset.js):
 *   expense  64.90  Transport  (also tagged "Work")
 *   expense  23.45  Groceries
 *   expense  12.10  Transport
 *   movement 80.00  cash withdrawn: counted, but not spent
 *   income   15.00  Refund
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { listAllBalanceProblems } = require("./helpers/balanceRule.js");
const { allMigrationsInOrder, LATEST_DATABASE_VERSION } = require("../backend/db/migrations/allMigrationsInOrder.js");
const { runPendingMigrations } = require("../backend/db/migrations/migrationRunner.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

const tagNamesOfTransaction = (transactionId) =>
  db.prepare(`SELECT t.name FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.transaction_id = ? ORDER BY t.name`).all(transactionId).map((row) => row.name);
const countRows = (tableName) => db.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get().n;
const findTagInReport = async (tagId) => (await call("GET", "/tags/report")).find((tag) => tag.id === tagId);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

// ---------- the migration ----------

// Runs migrations 1 … `version` by hand, the way the runner does, to get a database stuck at an older version
function createDatabaseAtVersion(version) {
  const olderDatabase = new Database(":memory:");
  olderDatabase.pragma("foreign_keys = OFF");
  for (let migrationNumber = 1; migrationNumber <= version; migrationNumber++) allMigrationsInOrder[migrationNumber - 1](olderDatabase);
  olderDatabase.pragma(`user_version = ${version}`);
  olderDatabase.pragma("foreign_keys = ON");
  return olderDatabase;
}

function runMigrationsQuietly(database) {
  const originalLog = console.log;
  console.log = () => {};
  try { runPendingMigrations(database); } finally { console.log = originalLog; }
}

test("migration 10 adds the tag tables to a version 9 database without touching its data", () => {
  const olderDatabase = createDatabaseAtVersion(9);
  olderDatabase.exec(`
    INSERT INTO accounts (id, name, kind, opening_balance, balance, open_date) VALUES (4, 'Bank', 'bank', 10000, 10000, '2026-01-01');
    INSERT INTO categories (id, name, kind) VALUES (7, 'Hotel', 'expense');
    INSERT INTO transactions (id, from_account_id, type, amount, category_id, date) VALUES (31, 4, 'expense', 2500, 7, '2026-02-01');
  `);
  runMigrationsQuietly(olderDatabase);

  assert.equal(olderDatabase.pragma("user_version", { simple: true }), LATEST_DATABASE_VERSION);
  assert.deepEqual(olderDatabase.pragma("foreign_key_check"), []);
  assert.deepEqual(olderDatabase.prepare(`SELECT id, balance FROM accounts`).all(), [{ id: 4, balance: 7500 }]);
  assert.deepEqual(olderDatabase.prepare(`SELECT id, amount, category_id FROM transactions`).all(), [{ id: 31, amount: 2500, category_id: 7 }]);
  assert.equal(olderDatabase.prepare(`SELECT COUNT(*) AS n FROM tags`).get().n, 0);

  // the rules the tables enforce by themselves
  olderDatabase.exec(`INSERT INTO tags (id, name, start_date, end_date) VALUES (1, 'Japan 2027', '2027-04-03', '2027-04-17')`);
  assert.throws(() => olderDatabase.exec(`INSERT INTO tags (name) VALUES ('JAPAN 2027')`), /UNIQUE/, "names are unique, whatever the capitals");
  assert.throws(() => olderDatabase.exec(`INSERT INTO tags (name) VALUES ('   ')`), /CHECK/, "a name can't be blank");
  assert.throws(() => olderDatabase.exec(`INSERT INTO tags (name, start_date, end_date) VALUES ('Back to front', '2027-05-02', '2027-05-01')`), /CHECK/);
  olderDatabase.exec(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (31, 1)`);
  assert.throws(() => olderDatabase.exec(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (31, 1)`), /UNIQUE|PRIMARY/, "a tag once per transaction");
  assert.throws(() => olderDatabase.exec(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (999, 1)`), /FOREIGN KEY/);

  // ON DELETE CASCADE, both ways: the links go, never the other side
  olderDatabase.exec(`DELETE FROM transactions WHERE id = 31`);
  assert.equal(olderDatabase.prepare(`SELECT COUNT(*) AS n FROM transaction_tags`).get().n, 0);
  assert.equal(olderDatabase.prepare(`SELECT COUNT(*) AS n FROM tags`).get().n, 1);
  olderDatabase.exec(`INSERT INTO transactions (id, from_account_id, type, amount, date) VALUES (32, 4, 'expense', 100, '2026-02-02');
                      INSERT INTO transaction_tags VALUES (32, 1); DELETE FROM tags WHERE id = 1;`);
  assert.equal(olderDatabase.prepare(`SELECT COUNT(*) AS n FROM transaction_tags`).get().n, 0);
  assert.equal(olderDatabase.prepare(`SELECT COUNT(*) AS n FROM transactions`).get().n, 1);
});

test("a later migration that rebuilds the transactions table keeps the tag links (as migration 10's comment promises)", () => {
  const database = createDatabaseAtVersion(10);
  database.exec(`
    INSERT INTO accounts (id, name, opening_balance, balance, open_date) VALUES (1, 'Cash', 0, 0, '2026-01-01');
    INSERT INTO transactions (id, to_account_id, type, amount, date) VALUES (5, 1, 'income', 100, '2026-01-02');
    INSERT INTO tags (id, name) VALUES (3, 'Trip');
    INSERT INTO transaction_tags VALUES (5, 3);
  `);
  // the same DROP + RENAME a migration does (same columns, same primary key), with foreign keys off as the runner has them
  const transactionsTableDefinition = database.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'`).get().sql;
  database.pragma("foreign_keys = OFF");
  database.exec(transactionsTableDefinition.replace(/^CREATE TABLE "?transactions"?/, "CREATE TABLE transactions_new"));
  database.exec(`
    INSERT INTO transactions_new SELECT * FROM transactions;
    DROP TABLE transactions;
    ALTER TABLE transactions_new RENAME TO transactions;
  `);
  database.pragma("foreign_keys = ON");
  assert.deepEqual(database.prepare(`SELECT * FROM transaction_tags`).all(), [{ transaction_id: 5, tag_id: 3 }]);
  assert.deepEqual(database.pragma("foreign_key_check"), []);
});

// ---------- a transaction's tags ----------

test("GET /transactions lists each transaction's tags, sorted by name; untagged ones have []", async () => {
  const transactions = await call("GET", "/transactions");
  const train = transactions.find((transaction) => transaction.id === dataset.lisbonTransactionIds[0]);
  assert.deepEqual(train.tags.map((tag) => tag.name), ["Lisbon 2025", "Work"]);
  assert.deepEqual(train.tags.map((tag) => tag.id), [dataset.tagIds.lisbon, dataset.tagIds.work]);
  const salary = transactions.find((transaction) => transaction.description === "Salary");
  assert.deepEqual(salary.tags, []);
});

test("a new tag name typed in the dialog is created with the transaction; an existing one in other capitals is reused", async () => {
  const tagsBefore = countRows("tags");
  const { id } = await call("POST", "/transactions", {
    type: "expense", amount: 9.5, from_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.groceries,
    new_tag_names: ["  Porto   weekend ", "lisbon 2025", "PORTO WEEKEND"],
  });
  assert.deepEqual(tagNamesOfTransaction(id), ["Lisbon 2025", "Porto weekend"]);
  assert.equal(countRows("tags"), tagsBefore + 1, "only Porto weekend is new");
});

test("a refused transaction leaves no new tag behind", async () => {
  const tagsBefore = countRows("tags"), transactionsBefore = countRows("transactions");
  const response = await callApi("POST", "/transactions", {
    type: "income", amount: 5, to_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.rent, // wrong kind
    new_tag_names: ["Never created"],
  });
  assert.equal(response.status, 400);
  assert.equal(countRows("tags"), tagsBefore);
  assert.equal(countRows("transactions"), transactionsBefore);
});

test("unknown tag ids, blank or too long names, and tags that aren't lists are refused", async () => {
  const base = { type: "expense", amount: 1, from_account_id: dataset.accountIds.cash };
  for (const tagFields of [{ tag_ids: [9999] }, { tag_ids: ["abc"] }, { new_tag_names: ["   "] }, { new_tag_names: ["x".repeat(61)] }, { tag_ids: 5 }]) {
    const response = await callApi("POST", "/transactions", { ...base, ...tagFields });
    assert.equal(response.status, 400, JSON.stringify(tagFields));
  }
});

test("editing: tags not sent are kept, a new list replaces them, an empty list removes them", async () => {
  const { id } = await call("POST", "/transactions", { type: "expense", amount: 3, from_account_id: dataset.accountIds.cash, tag_ids: [dataset.tagIds.lisbon], date: "2025-09-13" });
  const editedBody = { type: "expense", amount: 4, from_account_id: dataset.accountIds.cash, date: "2025-09-13" };

  await call("PUT", `/transactions/${id}`, editedBody);
  assert.deepEqual(tagNamesOfTransaction(id), ["Lisbon 2025"], "an edit that doesn't mention tags keeps them");

  await call("PUT", `/transactions/${id}`, { ...editedBody, tag_ids: [dataset.tagIds.work], new_tag_names: ["Souvenirs"] });
  assert.deepEqual(tagNamesOfTransaction(id), ["Souvenirs", "Work"]);

  await call("PUT", `/transactions/${id}`, { ...editedBody, tag_ids: [] });
  assert.deepEqual(tagNamesOfTransaction(id), []);
  assert.deepEqual(listAllBalanceProblems(db), [], "tags never change a balance");
});

test("a reconciliation can be tagged too (its details are editable), and deleting a transaction removes its links", async () => {
  const adjustment = db.prepare(`SELECT id, date FROM transactions WHERE type = 'adjustment'`).get();
  await call("PUT", `/transactions/${adjustment.id}`, { date: adjustment.date, description: "Counted", tag_ids: [dataset.tagIds.work] });
  assert.deepEqual(tagNamesOfTransaction(adjustment.id), ["Work"]);

  await call("DELETE", `/transactions/${adjustment.id}`);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM transaction_tags WHERE transaction_id = ?`).get(adjustment.id).n, 0);
  assert.ok(db.prepare(`SELECT 1 FROM tags WHERE id = ?`).get(dataset.tagIds.work), "the tag itself stays");
});

test("recurring rules ignore tags", async () => {
  const { id } = await call("POST", "/recurring-transactions", {
    type: "expense", amount: 2, from_account_id: dataset.accountIds.cash, repeat_unit: "month", start_date: "2026-01-01",
    tag_ids: [dataset.tagIds.lisbon], new_tag_names: ["Should not exist"],
  });
  const postedIds = db.prepare(`SELECT id FROM transactions WHERE recurring_transaction_id = ?`).all(id).map((row) => row.id);
  assert.ok(postedIds.length > 0);
  for (const postedId of postedIds) assert.deepEqual(tagNamesOfTransaction(postedId), []);
  assert.equal(db.prepare(`SELECT 1 FROM tags WHERE name = 'Should not exist'`).get(), undefined);
});

// ---------- managing tags ----------

test("adding a tag: name cleaned, dates optional, duplicates and back-to-front dates refused", async () => {
  const added = await call("POST", "/tags", { name: "  Japan   2027 ", start_date: "2027-04-03", end_date: "2027-04-17" });
  assert.deepEqual(added, { id: added.id, name: "Japan 2027", start_date: "2027-04-03", end_date: "2027-04-17" });
  assert.equal((await callApi("POST", "/tags", { name: "japan 2027" })).status, 409);
  assert.equal((await callApi("POST", "/tags", { name: "Bad dates", start_date: "2027-05-02", end_date: "2027-05-01" })).status, 400);
  assert.equal((await callApi("POST", "/tags", { name: "Bad date", start_date: "2027-02-30" })).status, 400);
  assert.equal((await callApi("POST", "/tags", { name: "" })).status, 400);

  const listed = (await call("GET", "/tags")).find((tag) => tag.id === added.id);
  assert.equal(listed.used, 0);
});

test("renaming and changing dates keep every link; renaming onto another tag asks, then merges", async () => {
  const { id: renamedId } = await call("POST", "/tags", { name: "Madrid" });
  const { id: firstId } = await call("POST", "/transactions", { type: "expense", amount: 1, from_account_id: dataset.accountIds.cash, tag_ids: [renamedId] });
  const { id: bothId } = await call("POST", "/transactions", { type: "expense", amount: 1, from_account_id: dataset.accountIds.cash, tag_ids: [renamedId, dataset.tagIds.unused] });

  await call("PUT", `/tags/${renamedId}`, { name: "Madrid 2026", start_date: "2026-05-01", end_date: "2026-05-04" });
  assert.deepEqual(tagNamesOfTransaction(firstId), ["Madrid 2026"]);

  const firstAnswer = await callApi("PUT", `/tags/${renamedId}`, { name: "UNUSED" });
  assert.equal(firstAnswer.status, 409);
  assert.equal(firstAnswer.body.merge_into.id, dataset.tagIds.unused);

  const merged = await call("PUT", `/tags/${renamedId}`, { name: "UNUSED", merge: true });
  assert.equal(merged.merged_into.id, dataset.tagIds.unused);
  assert.equal(db.prepare(`SELECT 1 FROM tags WHERE id = ?`).get(renamedId), undefined);
  assert.deepEqual(tagNamesOfTransaction(firstId), ["Unused"]);
  assert.deepEqual(tagNamesOfTransaction(bothId), ["Unused"], "a transaction that had both keeps one");
});

test("deleting a tag keeps its transactions", async () => {
  const { id: tagId } = await call("POST", "/tags", { name: "Short-lived" });
  const { id: transactionId } = await call("POST", "/transactions", { type: "expense", amount: 1, from_account_id: dataset.accountIds.cash, tag_ids: [tagId] });
  await call("DELETE", `/tags/${tagId}`);
  assert.ok(db.prepare(`SELECT 1 FROM transactions WHERE id = ?`).get(transactionId));
  assert.deepEqual(tagNamesOfTransaction(transactionId), []);
  assert.equal((await callApi("DELETE", `/tags/${tagId}`)).status, 404);
});

// ---------- what a tag adds up to ----------

test("the trip's totals: spent, received, net, count, dates, and spending by category", async () => {
  // earlier tests in this file also tag a few transactions "Lisbon 2025", so the totals are checked against
  // the database rather than fixed numbers (the next test checks fixed numbers on a trip of its own)
  const lisbon = await findTagInReport(dataset.tagIds.lisbon);
  assert.equal(lisbon.name, "Lisbon 2025");
  assert.equal(lisbon.start_date, "2025-09-10");
  assert.equal(lisbon.end_date, "2025-09-14");

  const lisbonExpenses = db.prepare(`
    SELECT t.amount FROM transactions t JOIN transaction_tags tt ON tt.transaction_id = t.id
    WHERE tt.tag_id = ? AND t.type = 'expense'`).all(dataset.tagIds.lisbon).reduce((sum, row) => sum + row.amount, 0);
  assert.equal(Math.round(lisbon.spent * 100), lisbonExpenses, "spent = the tagged expenses, to the cent");
  assert.equal(Math.round(lisbon.net * 100), Math.round(lisbon.received * 100) - Math.round(lisbon.spent * 100));
  const categoriesTotal = lisbon.expenses_by_category.reduce((sum, row) => sum + Math.round(row.total * 100), 0);
  assert.equal(categoriesTotal, Math.round(lisbon.spent * 100), "the categories add up to what was spent");
});

test("exact totals for a fresh trip, and they follow edits and deletions", async () => {
  const { id: tagId } = await call("POST", "/tags", { name: "Japan test", start_date: "2026-04-03", end_date: "2026-04-17" });
  const { cash, currentAccount } = dataset.accountIds;
  const { transport, groceries, refund } = dataset.categoryIds;
  const tagged = (transaction) => call("POST", "/transactions", { ...transaction, tag_ids: [tagId] });

  const flight = await tagged({ type: "expense", amount: 812.37, from_account_id: currentAccount, category_id: transport, date: "2026-04-02" });
  await tagged({ type: "expense", amount: 0.1, from_account_id: cash, category_id: groceries, date: "2026-04-05" });
  await tagged({ type: "expense", amount: 0.2, from_account_id: cash, category_id: groceries, date: "2026-04-06" });
  await tagged({ type: "expense", amount: 30, from_account_id: cash, date: "2026-04-07" }); // no category
  await tagged({ type: "movement", amount: 200, from_account_id: currentAccount, to_account_id: cash, date: "2026-04-03" });
  await tagged({ type: "income", amount: 40.5, to_account_id: currentAccount, category_id: refund, date: "2026-04-25" });

  let report = await findTagInReport(tagId);
  assert.deepEqual(
    { count: report.transaction_count, spent: report.spent, received: report.received, net: report.net, first: report.first_date, last: report.last_date },
    { count: 6, spent: 842.67, received: 40.5, net: -802.17, first: "2026-04-02", last: "2026-04-25" },
  );
  assert.deepEqual(report.expenses_by_category, [
    { category_id: transport, name: "Transport", total: 812.37, transaction_count: 1 },
    { category_id: null, name: "Uncategorized", total: 30, transaction_count: 1 },
    { category_id: groceries, name: "Groceries", total: 0.3, transaction_count: 2 }, // 0.1 + 0.2 summed in cents: exactly 0.3
  ]);
  assert.deepEqual(report.income_by_category, [{ category_id: refund, name: "Refund", total: 40.5, transaction_count: 1 }]);

  await call("PUT", `/transactions/${flight.id}`, { type: "expense", amount: 700, from_account_id: currentAccount, category_id: transport, date: "2026-04-02" });
  report = await findTagInReport(tagId);
  assert.equal(report.spent, 730.3, "an edit that doesn't mention tags keeps the flight in the trip");

  await call("DELETE", `/transactions/${flight.id}`);
  report = await findTagInReport(tagId);
  assert.equal(report.spent, 30.3);
  assert.equal(report.first_date, "2026-04-03");
});

test("an unused tag is in the report with zeros", async () => {
  const { id } = await call("POST", "/tags", { name: "Someday" });
  const someday = await findTagInReport(id);
  assert.deepEqual(
    { count: someday.transaction_count, spent: someday.spent, received: someday.received, net: someday.net, first: someday.first_date, categories: someday.expenses_by_category },
    { count: 0, spent: 0, received: 0, net: 0, first: null, categories: [] },
  );
});

// ---------- JSON backups ----------

test("a JSON backup keeps the tags and their links through export and import", async () => {
  const exported = await call("GET", "/export");
  assert.equal(exported.format_version, LATEST_DATABASE_VERSION);
  assert.ok(exported.tags.length > 0 && exported.transaction_tags.length > 0);
  const linksBefore = db.prepare(`SELECT * FROM transaction_tags ORDER BY transaction_id, tag_id`).all();
  const tagsBefore = db.prepare(`SELECT * FROM tags ORDER BY id`).all();
  const reportBefore = await call("GET", "/tags/report");

  await call("POST", "/import", exported);
  assert.deepEqual(db.prepare(`SELECT * FROM tags ORDER BY id`).all(), tagsBefore);
  assert.deepEqual(db.prepare(`SELECT * FROM transaction_tags ORDER BY transaction_id, tag_id`).all(), linksBefore);
  assert.deepEqual(await call("GET", "/tags/report"), reportBefore);
  assert.deepEqual(listAllBalanceProblems(db), []);
});

test("an older backup without tags still imports (with no tags), and a broken link stops the import untouched", async () => {
  const exported = await call("GET", "/export");

  const brokenBackup = { ...exported, transaction_tags: [...exported.transaction_tags, { transaction_id: 999999, tag_id: exported.tags[0].id }] };
  const refused = await callApi("POST", "/import", brokenBackup);
  assert.equal(refused.status, 400);
  assert.equal(countRows("transaction_tags"), exported.transaction_tags.length, "nothing changed");

  const { tags, transaction_tags: transactionTags, ...versionNineBackup } = exported;
  await call("POST", "/import", { ...versionNineBackup, format_version: 9 });
  assert.equal(countRows("tags"), 0);
  assert.equal(countRows("transaction_tags"), 0);
  assert.equal(countRows("transactions"), exported.transactions.length);

  await call("POST", "/import", exported); // put everything back for any test that runs after
  assert.equal(countRows("tags"), tags.length);
  assert.equal(countRows("transaction_tags"), transactionTags.length);
});
