/* PRINTS THE CONTENT OF EVERY TABLE. Uncomment the .run() lines below to insert sample rows first. */

const db = require("./database.js");

// With better-sqlite3 the object keys have no "$" prefix, only the SQL placeholders do.
// Money is in cents: 100 = 1,00 €.
const today = new Date().toISOString().substring(0, 10);

const test_account = { name: "Cash", kind: "cash", opening_balance: 10000, open_date: today };
// (the transaction's trigger updates Cash's balance by itself)
const test_investment = { ticker: "VWCE.MI", amount_invested: 5000, average_purchase_price: 125, shares: 40 };

const push_account = db.prepare(`
  INSERT INTO accounts (name, kind, opening_balance, balance, open_date) VALUES ($name, $kind, $opening_balance, $opening_balance, $open_date)
`);
// The account is looked up by name, so this works whatever id it got
const push_transaction = db.prepare(`
  INSERT INTO transactions (from_account_id, type, amount, description, date)
  VALUES ((SELECT id FROM accounts WHERE name = $account), 'expense', $amount, $description, $date)
`);
const push_investment = db.prepare(`
  INSERT INTO investments (ticker, amount_invested, average_purchase_price, shares)
  VALUES ($ticker, $amount_invested, $average_purchase_price, $shares)
`);

// push_account.run(test_account);
// push_transaction.run({ account: "Cash", amount: 1000, description: "Lunch", date: today });
// push_investment.run(test_investment);

for (const table of ["accounts", "categories", "transactions", "investments"]) {
  console.log(`\n========= ${table} =========`);
  console.table(db.prepare(`SELECT * FROM ${table}`).all());
}
