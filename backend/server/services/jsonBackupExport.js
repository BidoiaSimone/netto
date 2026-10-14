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
  };
}

module.exports = { buildJsonBackupFileName, buildFullJsonBackup };
