/* DATABASE SCHEMA, AS A LIST OF NUMBERED MIGRATIONS
 *
 * The schema is never edited in place. Each change is a new migration file in this folder, added at
 * the end of allMigrationsInOrder.js. SQLite keeps the number of the last migration applied in
 * `PRAGMA user_version`, so on startup only the migrations the database hasn't seen yet are run,
 * in order, each one all-or-nothing. A fresh database simply runs all of them.
 *
 * Rules: never edit or reorder a migration that has already run on someone's database;
 * to change something, add a new one.
 *
 * Money is stored as INTEGER cents (12,34 € -> 1234): floats can't hold most decimal amounts
 * exactly (0.1 + 0.2 = 0.30000000000000004), and those errors add up over thousands of rows.
 * Conversion to and from euros happens only at the API boundary (server/utils/moneyConversion.js).
 */

const fs = require("fs");
const path = require("path");
const { allMigrationsInOrder, LATEST_DATABASE_VERSION } = require("./allMigrationsInOrder.js");
const { BACKUPS_DIRECTORY } = require("../../config/projectPaths.js");
const { getTimestampForFileName } = require("../../server/utils/localDates.js");

// Runs the migrations this database hasn't had yet. Before touching a database that already
// has data, a copy is saved in backend/db/backups/ so an upgrade can always be undone by hand.
function runPendingMigrations(db, { backupDirectory = BACKUPS_DIRECTORY } = {}) {
  const currentVersion = db.pragma("user_version", { simple: true });
  if (currentVersion > LATEST_DATABASE_VERSION) {
    throw new Error(`money.db is at version ${currentVersion}, but this code only knows up to ${LATEST_DATABASE_VERSION}. Update the code (git pull).`);
  }
  if (currentVersion === LATEST_DATABASE_VERSION) return;

  if (databaseHasTables(db) && db.name !== ":memory:") {
    saveCopyBeforeMigrating(db, currentVersion, backupDirectory);
  }

  // Rebuilding tables means dropping tables that others reference, which the foreign key
  // check would refuse halfway through. It's switched off for the migration (it can only be
  // changed outside a transaction) and every reference is checked once at the end instead.
  const foreignKeysWereOn = db.pragma("foreign_keys", { simple: true });
  db.pragma("foreign_keys = OFF");
  try {
    for (let version = currentVersion + 1; version <= LATEST_DATABASE_VERSION; version++) {
      const migration = allMigrationsInOrder[version - 1];
      db.transaction(() => {
        migration(db);
        const brokenReferences = db.pragma("foreign_key_check");
        if (brokenReferences.length) {
          throw new Error(`migration ${version} left ${brokenReferences.length} broken reference(s), e.g. ${JSON.stringify(brokenReferences[0])}`);
        }
        db.pragma(`user_version = ${version}`);
      })();
      console.log(`Database upgraded to version ${version} (${migration.name})`);
    }
  } finally {
    if (foreignKeysWereOn) db.pragma("foreign_keys = ON");
  }
}

// sqlite_* tables are SQLite's own bookkeeping, not data
function databaseHasTables(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get().n > 0;
}

function saveCopyBeforeMigrating(db, currentVersion, backupDirectory) {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupFile = path.join(backupDirectory, `before-migration-v${currentVersion}-to-v${LATEST_DATABASE_VERSION}-${getTimestampForFileName()}.db`);
  db.prepare(`VACUUM INTO ?`).run(backupFile); // a consistent copy of the whole database, in one statement
  console.log(`Database backup saved to ${backupFile}`);
}

module.exports = { runPendingMigrations, LATEST_DATABASE_VERSION };
