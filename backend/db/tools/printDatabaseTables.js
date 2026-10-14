/* PRINTS THE CONTENT OF EVERY TABLE.  Usage: npm run db:print
 * Uncomment the .run() lines below to insert sample rows first. */

const db = require("../databaseConnection.js");
const { rebuildHoldingFromTrades } = require("../../server/services/holdingsCalculator.js");

// With better-sqlite3 the object keys have no "$" prefix, only the SQL placeholders do.
// Money is in cents: 100 = 1,00 €.
const today = new Date().toISOString().substring(0, 10);

const sampleAccount = { name: "Cash", kind: "cash", opening_balance: 10000, open_date: today };
// (the transaction's trigger updates Cash's balance by itself)
// A buy of 40 shares for 5000,00 € (cents). The holding in `investments` is rebuilt from the trades.
const sampleTrade = { ticker: "VWCE.MI", date: today, shares: 40, amount: 500000 };

const insertSampleAccount = db.prepare(`
  INSERT INTO accounts (name, kind, opening_balance, balance, open_date) VALUES ($name, $kind, $opening_balance, $opening_balance, $open_date)
`);
// The account is looked up by name, so this works whatever id it got
const insertSampleExpense = db.prepare(`
  INSERT INTO transactions (from_account_id, type, amount, description, date)
  VALUES ((SELECT id FROM accounts WHERE name = $account), 'expense', $amount, $description, $date)
`);
const insertSampleTrade = db.prepare(`
  INSERT INTO investment_trades (ticker, side, date, shares, amount) VALUES ($ticker, 'buy', $date, $shares, $amount)
`);

// insertSampleAccount.run(sampleAccount);
// insertSampleExpense.run({ account: "Cash", amount: 1000, description: "Lunch", date: today });
// insertSampleTrade.run(sampleTrade); rebuildHoldingFromTrades(sampleTrade.ticker);

for (const tableName of ["accounts", "categories", "transactions", "recurring_transactions", "investment_trades", "investments", "todos"]) {
  console.log(`\n========= ${tableName} =========`);
  console.table(db.prepare(`SELECT * FROM ${tableName}`).all());
}
