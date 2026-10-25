/* DEBUG: every table as stored (money in cents). Open http://localhost:3000/database in the browser.
 * Nothing is printed in the server log: the log file would otherwise keep a copy of your financial data.
 * Not used by the app's pages.
 */

const express = require("express");
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
    tags: db.prepare(`SELECT * FROM tags`).all(),
    transaction_tags: db.prepare(`SELECT * FROM transaction_tags`).all(),
    category_budgets: db.prepare(`SELECT * FROM category_budgets`).all(),
    forecast_phases: db.prepare(`SELECT * FROM forecast_phases`).all(),
    forecast_events: db.prepare(`SELECT * FROM forecast_events`).all(),
    forecast_assumptions: db.prepare(`SELECT * FROM forecast_assumptions`).all(),
    savings_goals: db.prepare(`SELECT * FROM savings_goals`).all(),
    savings_goal_categories: db.prepare(`SELECT * FROM savings_goal_categories`).all(),
    savings_goal_incomes: db.prepare(`SELECT * FROM savings_goal_incomes`).all(),
  };

  response.json(allTables);
});

module.exports = router;
