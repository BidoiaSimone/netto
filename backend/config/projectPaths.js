/* PROJECT PATHS
 * Every folder and file the backend reads or writes, in one place.
 * Moving a folder means changing one line here instead of hunting for path.join() calls.
 */

const path = require("path");

const PROJECT_ROOT_DIRECTORY = path.join(__dirname, "../..");

// The pages, styles, scripts and images served to the browser
const FRONTEND_DIRECTORY = path.join(PROJECT_ROOT_DIRECTORY, "frontend");

// The SQLite database file (SQLite adds money.db-wal and money.db-shm next to it while it's open)
const DATABASE_FILE = path.join(PROJECT_ROOT_DIRECTORY, "backend/db/money.db");

// Every kind of backup: automatic daily copies, copies made before a migration or an import,
// and the server-side copy of each downloaded JSON backup
const BACKUPS_DIRECTORY = path.join(PROJECT_ROOT_DIRECTORY, "backend/db/backups");

module.exports = { PROJECT_ROOT_DIRECTORY, FRONTEND_DIRECTORY, DATABASE_FILE, BACKUPS_DIRECTORY };
