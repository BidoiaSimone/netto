/* FULL JSON BACKUP (Settings > Download backup)
 * Every table as it is stored: money in integer cents, accounts referenced by id.
 * format_version is the database version (see db/migrations), so the import knows how to read the file.
 */

const db = require("../../db/databaseConnection.js");
const { LATEST_DATABASE_VERSION } = require("../../db/migrations/migrationRunner.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");

const buildJsonBackupFileName = () => `money-tracker-${getTodayAsLocalDate()}.json`; // local date, not UTC

function buildFullJsonBackup() {
  return {
    format_version: LATEST_DATABASE_VERSION,
    money_unit: "cents",
    accounts: db.prepare(`SELECT * FROM accounts ORDER BY id`).all(),
    investments: db.prepare(`SELECT * FROM investments`).all(),
    categories: db.prepare(`SELECT * FROM categories`).all(),
    recurring_transactions: db.prepare(`SELECT * FROM recurring_transactions ORDER BY id`).all(),
    transactions: db.prepare(`SELECT * FROM transactions`).all(),
    investment_trades: db.prepare(`SELECT * FROM investment_trades`).all(),
    todos: db.prepare(`SELECT * FROM todos ORDER BY id`).all(),
    tags: db.prepare(`SELECT * FROM tags ORDER BY id`).all(),                 // from version 10
    transaction_tags: db.prepare(`SELECT * FROM transaction_tags`).all(),     // which transaction has which tag, by id
    category_budgets: db.prepare(`SELECT * FROM category_budgets ORDER BY category_id, from_month`).all(), // from version 11
    forecast_phases: db.prepare(`SELECT * FROM forecast_phases ORDER BY from_month`).all(),               // from version 12
    forecast_events: db.prepare(`SELECT * FROM forecast_events ORDER BY month, id`).all(),
    forecast_assumptions: db.prepare(`SELECT * FROM forecast_assumptions WHERE id = 1`).get(),
    investment_targets: db.prepare(`SELECT * FROM investment_targets ORDER BY ticker`).all(),   // from version 15
    app_settings: db.prepare(`SELECT * FROM app_settings ORDER BY key`).all(),
    savings_goals: db.prepare(`SELECT * FROM savings_goals ORDER BY position, id`).all(),          // from version 17
    savings_goal_categories: db.prepare(`SELECT * FROM savings_goal_categories ORDER BY goal_id, category_id`).all(),
  };
}

module.exports = { buildJsonBackupFileName, buildFullJsonBackup };
