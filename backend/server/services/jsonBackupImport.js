/* RESTORE A JSON BACKUP (Settings > Restore backup). Replaces ALL current data.
 *
 * Older backups still work: those made before categories existed (a text `category`), those
 * made before version 2 (accounts by name, amounts in euros) and those made before version 4
 * (holdings typed in, no trades) are converted on the way in. Backups from before version 7 have no
 * recurring transactions: the import then simply has none. Backups from before version 8 have no
 * income / expense categories: each category gets its kind from how it is used, like migration 8 does.
 * Backups from before version 10 have no tags: the import then simply has none. Same for budgets before version 11,
 * and the forecast plan before version 12 (no phases or events, the default assumptions).
 *
 * Everything happens in one database transaction: on any bad row the old data stays untouched.
 */

const db = require("../../db/databaseConnection.js");
const { findFirstRecordedDate } = require("../../db/firstRecordedDate.js");
const { convertEurosToCents } = require("../utils/moneyConversion.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { rebuildHoldingFromTrades } = require("./holdingsCalculator.js");
const { assignCategoryKindsFromUsage } = require("../../db/migrations/008-category-kinds.js");

const OPENING_POSITION_NOTE = "Opening position (bought before trades were recorded)";

// Only these lists are required; the others are optional in older backups
function isValidBackupShape(backupData) {
  const requiredLists = ["accounts", "investments", "transactions"];
  return Boolean(backupData) && requiredLists.every((listName) => Array.isArray(backupData[listName]));
}

// Copies the listed columns of a row, using a default (or null) for the missing ones
const pickColumns = (row, columnNames, defaults = {}) =>
  Object.fromEntries(columnNames.map((columnName) => [columnName, row[columnName] ?? defaults[columnName] ?? null]));

// ---------- prepared statements ----------

// Holdings are never imported as they are: the trades go in, and each holding is rebuilt from them
const insertTrade = db.prepare(`INSERT INTO investment_trades (id, ticker, side, date, shares, amount, fees, account_id, transaction_id, note)
  VALUES (@id, @ticker, @side, @date, @shares, @amount, @fees, @account_id, @transaction_id, @note)`);
const insertCategory = db.prepare(`INSERT INTO categories (id, name, kind) VALUES (@id, @name, @kind)`);
// Every account starts at its opening balance: inserting the transactions afterwards lets the
// triggers bring each balance to the right amount, so balances in the file are never trusted blindly
const insertAccount = db.prepare(`INSERT INTO accounts (id, name, kind, opening_balance, balance, open_date, last_reconciled, closed_at)
  VALUES (@id, @name, @kind, @opening_balance, @opening_balance, @open_date, @last_reconciled, @closed_at)`);
const insertTransaction = db.prepare(`INSERT INTO transactions (id, from_account_id, to_account_id, type, amount, category_id, description, date, recurring_transaction_id)
  VALUES (@id, @from_account_id, @to_account_id, @type, @amount, @category_id, @description, @date, @recurring_transaction_id)`);
const insertRecurringTransaction = db.prepare(`INSERT INTO recurring_transactions (id, type, amount, from_account_id, to_account_id, category_id, description,
    repeat_unit, repeat_interval, start_date, end_date, posted_count, paused, created_at)
  VALUES (@id, @type, @amount, @from_account_id, @to_account_id, @category_id, @description,
    @repeat_unit, @repeat_interval, @start_date, @end_date, @posted_count, @paused, @created_at)`);
const insertTag = db.prepare(`INSERT INTO tags (id, name, start_date, end_date) VALUES (@id, @name, @start_date, @end_date)`);
const insertTransactionTag = db.prepare(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (@transaction_id, @tag_id)`);
const insertCategoryBudget = db.prepare(`INSERT INTO category_budgets (category_id, from_month, monthly_limit) VALUES (@category_id, @from_month, @monthly_limit)`);
const insertForecastPhase = db.prepare(`INSERT INTO forecast_phases (id, name, from_month, monthly_income, monthly_expenses)
  VALUES (@id, @name, @from_month, @monthly_income, @monthly_expenses)`);
const insertForecastEvent = db.prepare(`INSERT INTO forecast_events (id, name, month, amount, sells_account_id) VALUES (@id, @name, @month, @amount, @sells_account_id)`);
const insertTodo = db.prepare(`INSERT INTO todos (id, text, done, created_at, done_at) VALUES (@id, @text, @done, @created_at, @done_at)`);
const selectCategoryIdByName = db.prepare(`SELECT id FROM categories WHERE name = ?`);
const insertCategoryByName = db.prepare(`INSERT INTO categories (name) VALUES (?)`);

// Backups from before categories existed: category name -> id, creating it the first time it's seen
function findOrCreateCategoryId(categoryName) {
  const cleanName = String(categoryName ?? "").trim();
  if (!cleanName) return null;
  return selectCategoryIdByName.get(cleanName)?.id ?? insertCategoryByName.run(cleanName).lastInsertRowid;
}

// ---------- accounts and transactions ----------

// Current format (version 2+): rows go in as they are (the balance is rebuilt by the triggers).
// The recurring transactions go in between: they point to accounts, and transactions point to them.
function importAccountsAndTransactions(backupData) {
  for (const account of backupData.accounts) {
    insertAccount.run(pickColumns(account, ["id", "name", "kind", "opening_balance", "open_date", "last_reconciled", "closed_at"], { kind: "cash" }));
  }
  importRecurringTransactions(backupData);
  for (const transaction of backupData.transactions) {
    insertTransaction.run(pickColumns(transaction, ["id", "from_account_id", "to_account_id", "type", "amount", "category_id", "description", "date", "recurring_transaction_id"]));
  }
}

// In backups from version 7
function importRecurringTransactions(backupData) {
  if (!Array.isArray(backupData.recurring_transactions)) return;
  for (const rule of backupData.recurring_transactions) {
    insertRecurringTransaction.run(pickColumns(rule, ["id", "type", "amount", "from_account_id", "to_account_id", "category_id", "description",
      "repeat_unit", "repeat_interval", "start_date", "end_date", "posted_count", "paused", "created_at"],
      { repeat_interval: 1, posted_count: 0, paused: 0, created_at: getTodayAsLocalDate() }));
  }
}

// Old format (before version 2): accounts by name with a running `amount` in euros, transaction
// amounts in euros. Same conversion as migration 2: names become ids, euros become cents, and each
// account's opening balance is worked out backwards from its old amount.
function importLegacyAccountsAndTransactions(backupData) {
  const accountIdByName = new Map();
  for (const account of backupData.accounts) {
    const row = pickColumns(account, ["name", "kind", "open_date", "last_reconciled"], { kind: "cash" });
    const newAccountId = insertAccount.run({ ...row, id: null, opening_balance: 0, closed_at: null }).lastInsertRowid;
    accountIdByName.set(row.name, newAccountId);
  }
  const findAccountIdByName = (accountName) => {
    if (accountName === null || accountName === undefined || accountName === "") return null;
    if (!accountIdByName.has(accountName)) throw new Error(`a transaction uses the account "${accountName}", which isn't in the backup`);
    return accountIdByName.get(accountName);
  };
  for (const transaction of backupData.transactions) {
    const row = pickColumns(transaction, ["id", "type", "category_id", "description", "date"]);
    if (row.category_id === null) row.category_id = findOrCreateCategoryId(transaction.category);
    insertTransaction.run({
      ...row,
      recurring_transaction_id: null,
      from_account_id: findAccountIdByName(transaction.from_account),
      to_account_id: findAccountIdByName(transaction.to_account),
      amount: convertEurosToCents(transaction.amount),
    });
  }
  // Each account started at 0 and the triggers added up its transactions into `balance`;
  // the old amount is the real balance, so the opening balance is the part not explained by them.
  const setOpeningBalanceFromRealBalance = db.prepare(`
    UPDATE accounts SET opening_balance = @amount - balance, balance = @amount WHERE id = @id`);
  for (const account of backupData.accounts) {
    setOpeningBalanceFromRealBalance.run({ id: accountIdByName.get(account.name), amount: convertEurosToCents(account.amount) });
  }
}

// ---------- investments ----------

// Version 4+: the trades as they are. Before: each holding (shares + amount invested in euros)
// becomes one opening 'buy' trade, like migration 4 does.
function importInvestments(backupData) {
  if ((backupData.format_version ?? 0) >= 4) {
    if (!Array.isArray(backupData.investment_trades)) throw new Error("the backup has no investment_trades list");
    for (const trade of backupData.investment_trades) {
      insertTrade.run(pickColumns(trade, ["id", "ticker", "side", "date", "shares", "amount", "fees", "account_id", "transaction_id", "note"], { fees: 0 }));
    }
  } else {
    const openingPositionDate = findFirstRecordedDate(db); // the start of the imported records, as in migration 4
    for (const holding of backupData.investments) {
      const amountInCents = convertEurosToCents(holding.amount_invested ?? Number(holding.shares) * Number(holding.average_purchase_price));
      if (!(Number(holding.shares) > 0) || !(amountInCents > 0)) continue;
      insertTrade.run({
        id: null, ticker: String(holding.ticker).trim().toUpperCase(), side: "buy", date: openingPositionDate,
        shares: Number(holding.shares), amount: amountInCents, fees: 0, account_id: null, transaction_id: null, note: OPENING_POSITION_NOTE,
      });
    }
  }
  const tradedTickers = db.prepare(`SELECT DISTINCT ticker FROM investment_trades`).all();
  for (const { ticker } of tradedTickers) rebuildHoldingFromTrades(ticker); // throws if the trades don't add up
}

// ---------- tags ----------

// In backups from version 10. Ids are kept, so the links in transaction_tags still point to the right
// transaction and tag; a link to a transaction or tag that isn't in the file stops the import (foreign keys).
function importTags(backupData) {
  if (!Array.isArray(backupData.tags)) return;
  for (const tag of backupData.tags) insertTag.run(pickColumns(tag, ["id", "name", "start_date", "end_date"]));
  for (const link of backupData.transaction_tags ?? []) insertTransactionTag.run(pickColumns(link, ["transaction_id", "tag_id"]));
}

// ---------- budgets ----------

// In backups from version 11: every row of the history, pointing to categories by id (imported first)
function importCategoryBudgets(backupData) {
  for (const budgetRow of backupData.category_budgets ?? []) insertCategoryBudget.run(pickColumns(budgetRow, ["category_id", "from_month", "monthly_limit"]));
}

// ---------- the forecast plan ----------

// In backups from version 12. The assumptions row always exists (migration 12): it's reset to the defaults,
// then given the backup's values if it has them. Events point to accounts by id (imported before).
function importForecastPlan(backupData) {
  for (const phase of backupData.forecast_phases ?? []) insertForecastPhase.run(pickColumns(phase, ["id", "name", "from_month", "monthly_income", "monthly_expenses"]));
  for (const event of backupData.forecast_events ?? []) insertForecastEvent.run(pickColumns(event, ["id", "name", "month", "amount", "sells_account_id"]));
  db.exec(`DELETE FROM forecast_assumptions; INSERT INTO forecast_assumptions (id) VALUES (1);`);
  const assumptions = backupData.forecast_assumptions;
  if (assumptions) {
    db.prepare(`UPDATE forecast_assumptions SET yearly_return = @yearly_return, yearly_inflation = @yearly_inflation,
                savings_go_to = @savings_go_to, yearly_depreciation = @yearly_depreciation WHERE id = 1`)
      .run(pickColumns(assumptions, ["yearly_return", "yearly_inflation", "savings_go_to", "yearly_depreciation"],
        { yearly_return: 0.05, yearly_inflation: 0.02, savings_go_to: "cash", yearly_depreciation: 0.15 }));
  }
}

// ---------- the Next up list ----------

// In backups from version 5. An older backup has no list: the current one is kept.
function importTodos(backupData) {
  if (!Array.isArray(backupData.todos)) return;
  db.exec(`DELETE FROM todos`);
  const today = getTodayAsLocalDate();
  for (const todo of backupData.todos) {
    insertTodo.run({ ...pickColumns(todo, ["id", "text", "created_at", "done_at"], { created_at: today }), done: todo.done ? 1 : 0 });
  }
}

// ---------- everything together ----------

// All or nothing: throws (and changes nothing) on any bad row
const replaceAllDataWithBackup = db.transaction((backupData) => {
  db.exec(`DELETE FROM forecast_events; DELETE FROM forecast_phases;
           DELETE FROM category_budgets; DELETE FROM transaction_tags; DELETE FROM tags;
           DELETE FROM investment_trades; DELETE FROM investments; DELETE FROM transactions; DELETE FROM recurring_transactions;
           DELETE FROM categories; DELETE FROM accounts;`);
  const categories = Array.isArray(backupData.categories) ? backupData.categories : [];
  for (const category of categories) insertCategory.run(pickColumns(category, ["id", "name", "kind"], { kind: "expense" }));
  if ((backupData.format_version ?? 0) >= 2) importAccountsAndTransactions(backupData);
  else importLegacyAccountsAndTransactions(backupData);
  importInvestments(backupData); // after the transactions: trades point at their cash transaction
  importTags(backupData);         // after the transactions too: the links point at them
  importCategoryBudgets(backupData);
  importForecastPlan(backupData);
  importTodos(backupData);
  if ((backupData.format_version ?? 0) < 8) assignCategoryKindsFromUsage(db);
});

// How many rows each table holds after the import, for the confirmation message
function countImportedRows() {
  const countRows = (tableName) => db.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get().n;
  return {
    accounts: countRows("accounts"),
    investments: countRows("investments"),
    categories: countRows("categories"),
    transactions: countRows("transactions"),
    recurring_transactions: countRows("recurring_transactions"),
    todos: countRows("todos"),
    tags: countRows("tags"),
    category_budgets: countRows("category_budgets"),
  };
}

module.exports = { isValidBackupShape, replaceAllDataWithBackup, countImportedRows };
