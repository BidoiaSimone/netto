/* PRINTS THE CONTENT OF EVERY TABLE. Uncomment the .run() lines below to insert sample rows first. */

const db = require("./database.js");

// With better-sqlite3 the object keys have no "$" prefix, only the SQL placeholders do
const today = new Date().toISOString().substring(0, 10);

const test_account = { name: "Cash", amount: 100, open_date: today };
const test_transaction = { from_account: "Cash", to_account: null, type: "expense", amount: 10, description: "Lunch", date: today };
const test_investment = { ticker: "VWCE.MI", amount_invested: 5000, average_purchase_price: 125, shares: 40 };

const push_account = db.prepare(`
  INSERT INTO accounts (name, amount, open_date) VALUES ($name, $amount, $open_date)
`);
const push_transaction = db.prepare(`
  INSERT INTO transactions (from_account, to_account, type, amount, description, date)
  VALUES ($from_account, $to_account, $type, $amount, $description, $date)
`);
const push_investment = db.prepare(`
  INSERT INTO investments (ticker, amount_invested, average_purchase_price, shares)
  VALUES ($ticker, $amount_invested, $average_purchase_price, $shares)
`);

// push_account.run(test_account);
// push_transaction.run(test_transaction);
// push_investment.run(test_investment);

for (const table of ["transactions", "investments", "accounts"]) {
  console.log(`\n========= ${table} =========`);
  console.table(db.prepare(`SELECT * FROM ${table}`).all());
}
