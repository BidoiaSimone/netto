/* PROJECT PATHS
 * Every folder and file the backend reads or writes, in one place.
 * Moving a folder means changing one line here instead of hunting for path.join() calls.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { IS_LIGHT_EDITION } = require("./edition.js");

const PROJECT_ROOT_DIRECTORY = path.join(__dirname, "../..");

// netto light (config/edition.js) keeps its data apart: light.db, light-backups/, "netto light backups".
// The environment variables below still win over these, as for the full app.
const DEFAULT_DATABASE_NAME = IS_LIGHT_EDITION ? "light.db" : "money.db";
const DEFAULT_BACKUPS_FOLDER = IS_LIGHT_EDITION ? "light-backups" : "backups";
const DEFAULT_OFFSITE_FOLDER = IS_LIGHT_EDITION ? "netto light backups" : "netto backups";

// The pages, styles, scripts and images served to the browser
const FRONTEND_DIRECTORY = path.join(PROJECT_ROOT_DIRECTORY, "frontend");

// The SQLite database file (SQLite adds money.db-wal and money.db-shm next to it while it's open).
// NETTO_DATABASE_FILE points it somewhere else: the tests set it to ":memory:" (a database that lives
// only in RAM and vanishes when the process ends), so they can never read or change your real money.db.
// Without it, as in `npm start`, it is money.db as always (light.db for `npm run light`).
const DATABASE_FILE = process.env.NETTO_DATABASE_FILE || path.join(PROJECT_ROOT_DIRECTORY, "backend/db", DEFAULT_DATABASE_NAME);

// Every kind of backup: automatic daily copies, copies made before a migration or an import,
// and the server-side copy of each downloaded JSON backup.
// NETTO_BACKUPS_DIRECTORY moves it too, for the same reason: tests write their backups to a temporary folder.
const BACKUPS_DIRECTORY = process.env.NETTO_BACKUPS_DIRECTORY || path.join(PROJECT_ROOT_DIRECTORY, "backend/db", DEFAULT_BACKUPS_FOLDER);

// iCloud Drive as the Finder shows it (it's this folder on every Mac signed in to iCloud with iCloud Drive on)
const ICLOUD_DRIVE_DIRECTORY = path.join(os.homedir(), "Library/Mobile Documents/com~apple~CloudDocs");

// A copy of each daily backup that isn't on this Mac's disk (services/automaticDailyBackups.js): "netto backups" in
// iCloud Drive. NETTO_OFFSITE_BACKUPS_DIRECTORY points it elsewhere (the tests use a temporary folder; it could
// also be a USB drive or another synced folder).
const OFFSITE_BACKUPS_DIRECTORY = process.env.NETTO_OFFSITE_BACKUPS_DIRECTORY || path.join(ICLOUD_DRIVE_DIRECTORY, DEFAULT_OFFSITE_FOLDER);
// The copy is only made where this already exists: no iCloud Drive on this Mac = no copy, rather than a folder
// created somewhere it's never synced from
const OFFSITE_BACKUPS_PARENT_DIRECTORY = path.dirname(OFFSITE_BACKUPS_DIRECTORY);

// A running server only knows the paths it worked out when it started. If the project folder is renamed or moved
// while it runs (money-tracker -> Netto, Oct 2026), those paths point to a folder that is gone, and creating the
// backups folder "recursively" would quietly rebuild an empty money-tracker/backend/db/backups next to the real
// project. So before creating any backups folder, the server checks its own folder is still there.
const isProjectFolderStillThere = () => fs.existsSync(path.join(PROJECT_ROOT_DIRECTORY, "backend/server/app.js"));

// The backups folder, created if needed, but only while the project folder is still where the server started from
function makeBackupsDirectory(directory = BACKUPS_DIRECTORY) {
  if (!isProjectFolderStillThere()) {
    throw new Error(`netto's folder is no longer at ${PROJECT_ROOT_DIRECTORY} (renamed or moved?): run bash scripts/service.sh install from its new place`);
  }
  fs.mkdirSync(directory, { recursive: true });
}

module.exports = { isProjectFolderStillThere, makeBackupsDirectory, PROJECT_ROOT_DIRECTORY, FRONTEND_DIRECTORY, DATABASE_FILE, BACKUPS_DIRECTORY, OFFSITE_BACKUPS_DIRECTORY, OFFSITE_BACKUPS_PARENT_DIRECTORY };
