/* PROJECT PATHS
 * Every folder and file the backend reads or writes, in one place.
 * Moving a folder means changing one line here instead of hunting for path.join() calls.
 */

const path = require("path");

const PROJECT_ROOT_DIRECTORY = path.join(__dirname, "../..");

// The pages, styles, scripts and images served to the browser
const FRONTEND_DIRECTORY = path.join(PROJECT_ROOT_DIRECTORY, "frontend");

// The SQLite database file (SQLite adds money.db-wal and money.db-shm next to it while it's open).
// NETTO_DATABASE_FILE points it somewhere else: the tests set it to ":memory:" (a database that lives
// only in RAM and vanishes when the process ends), so they can never read or change your real money.db.
// Without it, as in `npm start`, it is money.db as always.
const DATABASE_FILE = process.env.NETTO_DATABASE_FILE || path.join(PROJECT_ROOT_DIRECTORY, "backend/db/money.db");

// Every kind of backup: automatic daily copies, copies made before a migration or an import,
// and the server-side copy of each downloaded JSON backup.
// NETTO_BACKUPS_DIRECTORY moves it too, for the same reason: tests write their backups to a temporary folder.
const BACKUPS_DIRECTORY = process.env.NETTO_BACKUPS_DIRECTORY || path.join(PROJECT_ROOT_DIRECTORY, "backend/db/backups");

module.exports = { PROJECT_ROOT_DIRECTORY, FRONTEND_DIRECTORY, DATABASE_FILE, BACKUPS_DIRECTORY };
