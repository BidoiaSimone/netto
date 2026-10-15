/* MIGRATIONS (backend/db/migrations/)
 * Every database, whatever version it is at, must end up at the latest version with its data intact.
 * These tests open their own databases (not the shared test one) so each starts exactly where it should:
 * one completely empty, one in the very first shape netto ever had (version 0, before migrations existed).
 */

const { TEMPORARY_BACKUPS_DIRECTORY } = require("./helpers/testEnvironment.js"); // first: see that file
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { runPendingMigrations, LATEST_DATABASE_VERSION } = require("../backend/db/migrations/migrationRunner.js");
const { listAllBalanceProblems } = require("./helpers/balanceRule.js");

// The migrations print one line per version; useful in the app, noise in the test output
function runMigrationsQuietly(db, options) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    runPendingMigrations(db, options);
  } finally {
    console.log = originalLog;
  }
}

// Opened the same way databaseConnection.js opens money.db
function openDatabase(file) {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  return db;
}

// The schema before migrations existed (what migration 1 calls "databases from that time"): accounts by
// name, money as euro floats, a free-text category column, and holdings typed in by hand.
// Transaction ids have gaps on purpose (rows deleted long ago): the migrations must keep them as they are.
function createVersionZeroDatabaseWithData(file) {
  const db = openDatabase(file);
  db.exec(`
    CREATE TABLE accounts (name TEXT PRIMARY KEY, amount REAL NOT NULL, kind TEXT NOT NULL DEFAULT 'cash', open_date TEXT NOT NULL, last_reconciled TEXT);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, from_account TEXT, to_account TEXT,
      type TEXT NOT NULL, amount REAL NOT NULL, category TEXT, description TEXT, date TEXT NOT NULL
    );
    CREATE TABLE investments (ticker TEXT PRIMARY KEY, amount_invested REAL NOT NULL, average_purchase_price REAL NOT NULL, shares REAL NOT NULL);

    -- amount = the balance today (it was a running total back then)
    INSERT INTO accounts VALUES ('Cash', 45.5, 'cash', '2025-01-01', NULL);
    INSERT INTO accounts VALUES ('Bank', 1234.56, 'bank', '2025-01-01', '2025-03-01');
    INSERT INTO accounts VALUES ('Car', 9000, 'asset', '2025-02-01', NULL);

    INSERT INTO transactions VALUES (3, NULL, 'Bank', 'income', 1500.1, 'Salary', NULL, '2025-01-27');
    INSERT INTO transactions VALUES (7, 'Cash', NULL, 'expense', 23.45, 'Groceries', 'market', '2025-02-03');
    INSERT INTO transactions VALUES (8, 'Bank', 'Cash', 'movement', 200, NULL, NULL, '2025-02-04');
    INSERT INTO transactions VALUES (12, NULL, 'Cash', 'income', 30, 'Gift', 'birthday', '2025-02-10');
    INSERT INTO transactions VALUES (13, 'Bank', NULL, 'expense', 60.99, 'Gift', NULL, '2025-02-11');
    INSERT INTO transactions VALUES (20, NULL, 'Cash', 'adjustment', 0.05, NULL, 'Reconciliation', '2025-03-01');

    INSERT INTO investments VALUES ('VWCE.MI', 1000.5, 100.05, 10);
    INSERT INTO investments VALUES ('SOLD.MI', 0, 0, 0);  -- nothing held any more: not carried over
  `);
  return db;
}

test("an empty database migrates to the latest version", () => {
  const db = openDatabase(":memory:");
  runMigrationsQuietly(db);

  assert.equal(db.pragma("user_version", { simple: true }), LATEST_DATABASE_VERSION);
  const tableNames = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
  assert.deepEqual(tableNames, ["accounts", "categories", "category_budgets", "forecast_assumptions", "forecast_events", "forecast_phases", "investment_trades", "investments", "recurring_transactions", "tags", "todos", "transaction_tags", "transactions"]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");

  // the balance triggers exist and work on the fresh schema
  db.prepare(`INSERT INTO accounts (name, kind, opening_balance, balance, open_date) VALUES ('Test', 'restricted', 1000, 1000, '2026-01-01')`).run();
  db.prepare(`INSERT INTO transactions (from_account_id, type, amount, date) VALUES (1, 'expense', 250, '2026-01-02')`).run();
  assert.equal(db.prepare(`SELECT balance FROM accounts`).get().balance, 750);
});

test("a version 0 database with data migrates to the latest version, keeping ids, balances and references", () => {
  const temporaryFolder = fs.mkdtempSync(path.join(os.tmpdir(), "netto-test-migration-"));
  const databaseFile = path.join(temporaryFolder, "old.db");
  const db = createVersionZeroDatabaseWithData(databaseFile);

  runMigrationsQuietly(db, { backupDirectory: TEMPORARY_BACKUPS_DIRECTORY });

  assert.equal(db.pragma("user_version", { simple: true }), LATEST_DATABASE_VERSION);
  assert.deepEqual(db.pragma("foreign_key_check"), [], "no transaction, trade or rule points to something missing");
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");

  // accounts get ids in creation order; every balance is exactly the old amount, in cents
  const accounts = db.prepare(`SELECT id, name, kind, balance, open_date, last_reconciled FROM accounts ORDER BY id`).all();
  assert.deepEqual(accounts, [
    { id: 1, name: "Cash", kind: "cash", balance: 4550, open_date: "2025-01-01", last_reconciled: null },
    { id: 2, name: "Bank", kind: "bank", balance: 123456, open_date: "2025-01-01", last_reconciled: "2025-03-01" },
    { id: 3, name: "Car", kind: "asset", balance: 900000, open_date: "2025-02-01", last_reconciled: null },
  ]);
  assert.deepEqual(listAllBalanceProblems(db), [], "opening balance + money in − money out = stored balance");

  // transaction ids unchanged (gaps included), amounts in cents, accounts by id
  const transactions = db.prepare(`SELECT id, from_account_id, to_account_id, type, amount, description FROM transactions ORDER BY id`).all();
  assert.deepEqual(transactions, [
    { id: 3, from_account_id: null, to_account_id: 2, type: "income", amount: 150010, description: null },
    { id: 7, from_account_id: 1, to_account_id: null, type: "expense", amount: 2345, description: "market" },
    { id: 8, from_account_id: 2, to_account_id: 1, type: "movement", amount: 20000, description: null },
    { id: 12, from_account_id: null, to_account_id: 1, type: "income", amount: 3000, description: "birthday" },
    { id: 13, from_account_id: 2, to_account_id: null, type: "expense", amount: 6099, description: null },
    { id: 20, from_account_id: null, to_account_id: 1, type: "adjustment", amount: 5, description: "Reconciliation" },
  ]);

  // free-text categories became rows with a kind; "Gift" was used both ways, so it got an income twin
  const categoryOfTransaction = (transactionId) => db.prepare(`
    SELECT c.name, c.kind FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.id = ?
  `).get(transactionId);
  assert.deepEqual(categoryOfTransaction(3), { name: "Salary", kind: "income" });
  assert.deepEqual(categoryOfTransaction(7), { name: "Groceries", kind: "expense" });
  assert.deepEqual(categoryOfTransaction(12), { name: "Gift", kind: "income" });
  assert.deepEqual(categoryOfTransaction(13), { name: "Gift", kind: "expense" });

  // the held investment became one opening-position trade dated at the first record; the empty one is gone
  const trades = db.prepare(`SELECT ticker, side, date, shares, amount, account_id FROM investment_trades`).all();
  assert.deepEqual(trades, [{ ticker: "VWCE.MI", side: "buy", date: "2025-01-01", shares: 10, amount: 100050, account_id: null }]);
  assert.deepEqual(db.prepare(`SELECT ticker, shares, amount_invested, realized_gain FROM investments`).all(),
    [{ ticker: "VWCE.MI", shares: 10, amount_invested: 100050, realized_gain: 0 }]);

  // a database that had data was copied first, into the folder given (never into backend/db/backups here)
  const backupFiles = fs.readdirSync(TEMPORARY_BACKUPS_DIRECTORY).filter((name) => name.startsWith("before-migration-v0-"));
  assert.equal(backupFiles.length, 1);
  db.close();
});

test("running the migrations again on an up-to-date database changes nothing", () => {
  const db = openDatabase(":memory:");
  runMigrationsQuietly(db);
  const schemaBefore = db.prepare(`SELECT sql FROM sqlite_master ORDER BY name`).all();
  runMigrationsQuietly(db);
  assert.deepEqual(db.prepare(`SELECT sql FROM sqlite_master ORDER BY name`).all(), schemaBefore);
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_DATABASE_VERSION);
});

test("a database newer than the code is refused instead of being damaged", () => {
  const db = openDatabase(":memory:");
  db.pragma(`user_version = ${LATEST_DATABASE_VERSION + 1}`);
  assert.throws(() => runMigrationsQuietly(db), /only knows up to/);
});
