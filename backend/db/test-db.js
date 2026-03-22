/* TESTS DATABASE CONNECTION AND VARIOUS QUERIES */

// Dependencies 
const db = require("./database.js");

// DTO
const test_transaction = {
  $from_account: "Cash",
  $type: "expense",
  $amount: 10,
  $description: "Pranzo sushi",
  $date: new Date().toISOString().substring(0, 10) // will come from user input
}

// DTO
const test_account = {
  $name: "Cash",
  $amount: 9089.98,
  $open_date: "2024-12-24"
}

// DTO 
const test_investment = {
  $ticker: "VWCE",
  $amount_invested: 5490.23,
  $average_purchase_price: 149.12,
  $shares: 35
}

// DTO
const test_movement = {
  $from_account: "BCC",
  $to_account: "VWCE",
  $type: "movement",
  $amount: 3000,
  $description: "Liquidità",
  $date: new Date().toISOString().substring(0, 10) // will come from user input
}

// Preparing the db query prevents SQL injections
const push_transaction_query = db.prepare(`
  INSERT INTO transactions (from_account, type, amount, description, date)
  VALUES ($from_account, $type, $amount, $description, $date)
`);

const push_mevement_query = db.prepare(`
  INSERT INTO transactions (from_account, to_account, type, amount, description, date)
  VALUES ($from_account, $to_account, $type, $amount, $description, $date)
`);

const push_investment_query = db.prepare(`
  INSERT INTO investments (ticker, amount_invested, average_purchase_price, shares)
  VALUES ($ticker, $amount_invested, $average_purchase_price, $shares)
`);

const push_account_query = db.prepare(`
  INSERT INTO accounts (name, amount, open_date)
  VALUES ($name, $amount, $open_date)
`);

// If the values in the prepared query are named with $value then I can run directly with the objet
//push_transaction_query.run(test_transaction);

//push_mevement_query.run(test_movement);

//push_investment_query.run(test_investment);

//push_account_query.run(test_account);

db.serialize(() => {
  db.all(`SELECT * FROM transactions`, [], (err, rows) => {
    if (err) {
      throw err;
    }
    console.log("┌────────────────────────────────┐");
    console.log("│========= Transactions =========│");
    console.log("└────────────────────────────────┘");
    console.table(rows);
  });

  db.all(`SELECT * FROM investments`, [], (err, rows) => {
    if (err) {
      throw err;
    }
    console.log("┌───────────────────────────────┐");
    console.log("│========= Investments =========│");
    console.log("└───────────────────────────────┘");
    console.table(rows);
  });

  db.all(`SELECT * FROM accounts`, [], (err, rows) => {
    if (err) {
      throw err;
    }
    console.log("┌────────────────────────────┐");
    console.log("│========= Accounts =========│");
    console.log("└────────────────────────────┘");
    console.table(rows);
  });
});

