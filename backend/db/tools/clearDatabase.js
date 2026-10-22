/* DELETES EVERY TABLE AND CREATES THEM AGAIN EMPTY.  Usage: npm run db:clear -- --yes
 * (or: node backend/db/tools/clearDatabase.js --yes) */

if (!process.argv.includes("--yes")) {
  console.log("This deletes ALL data in money.db. Run again with --yes to confirm.");
  process.exit(1);
}

const db = require("../databaseConnection.js");
const { runPendingMigrations } = require("../migrations/migrationRunner.js");

// The tables that point to others go first
db.pragma("foreign_keys = OFF");
db.exec(`
  DROP VIEW IF EXISTS account_balances;
  DROP TABLE IF EXISTS offline_submissions;
  DROP TABLE IF EXISTS savings_goal_incomes;
  DROP TABLE IF EXISTS savings_goal_categories;
  DROP TABLE IF EXISTS savings_goals;
  DROP TABLE IF EXISTS investment_targets;
  DROP TABLE IF EXISTS app_settings;
  DROP TABLE IF EXISTS forecast_events;
  DROP TABLE IF EXISTS forecast_phases;
  DROP TABLE IF EXISTS forecast_assumptions;
  DROP TABLE IF EXISTS category_budgets;
  DROP TABLE IF EXISTS transaction_tags;
  DROP TABLE IF EXISTS tags;
  DROP TABLE IF EXISTS investment_trades;
  DROP TABLE IF EXISTS todos;
  DROP TABLE IF EXISTS transactions;
  DROP TABLE IF EXISTS recurring_transactions;
  DROP TABLE IF EXISTS categories;
  DROP TABLE IF EXISTS investments;
  DROP TABLE IF EXISTS accounts;
`);
db.pragma("user_version = 0"); // an empty database: every migration runs again
db.pragma("foreign_keys = ON");
runPendingMigrations(db);

console.log("Database cleared.");
