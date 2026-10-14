/* THE DATABASE CONNECTION
 * Opens money.db once; every file that needs the database requires this one and shares the connection.
 */

const Database = require("better-sqlite3");
const { DATABASE_FILE } = require("../config/projectPaths.js");
const { runPendingMigrations } = require("./migrations/migrationRunner.js");
const { findAccountsWithWrongBalance } = require("./balanceIntegrityCheck.js");

const db = new Database(DATABASE_FILE);
db.pragma("journal_mode = WAL"); // for performance
db.pragma("foreign_keys = ON");  // SQLite ignores REFERENCES (e.g. transactions -> accounts) unless this is on

runPendingMigrations(db);          // brings the tables up to date (see migrations/)
findAccountsWithWrongBalance(db);  // warns if a stored balance doesn't match its transactions

module.exports = db;
