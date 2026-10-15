/* DEBUG: every table as stored (money in cents). Open http://localhost:3000/database in the browser;
 * the main tables are also printed in the server log. Not used by the app's pages.
 */

const express = require("express");
const chalk = require("chalk");
const db = require("../../db/databaseConnection.js");

const router = express.Router();

router.get("/database", function dumpWholeDatabase(request, response) {
  const allTables = {
    accounts: db.prepare(`SELECT * FROM accounts`).all(),
    investments: db.prepare(`SELECT * FROM investments`).all(),
    categories: db.prepare(`SELECT * FROM categories`).all(),
    transactions: db.prepare(`SELECT * FROM transactions`).all(),
    recurring_transactions: db.prepare(`SELECT * FROM recurring_transactions`).all(),
    investment_trades: db.prepare(`SELECT * FROM investment_trades`).all(),
    todos: db.prepare(`SELECT * FROM todos`).all(),
    tags: db.prepare(`SELECT * FROM tags`).all(),
    transaction_tags: db.prepare(`SELECT * FROM transaction_tags`).all(),
    category_budgets: db.prepare(`SELECT * FROM category_budgets`).all(),
    forecast_phases: db.prepare(`SELECT * FROM forecast_phases`).all(),
    forecast_events: db.prepare(`SELECT * FROM forecast_events`).all(),
    forecast_assumptions: db.prepare(`SELECT * FROM forecast_assumptions`).all(),
  };

  for (const [title, tableName] of [["Accounts", "accounts"], ["Categories", "categories"], ["Transactions", "transactions"], ["Investments", "investments"]]) {
    console.log(chalk.blue(`\n${title}:`));
    console.log(JSON.stringify(allTables[tableName], null, 2));
  }
  response.json(allTables);
});

module.exports = router;
