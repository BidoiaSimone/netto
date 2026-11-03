/* THE COPY SAVED BEFORE A DATABASE UPGRADE, IN THE BROWSER: stands in for backend/db/migrations/copyBeforeMigrating.js
 * There's no backups folder: the copy goes next to money.db, in the same private storage (OPFS, "opfs-sahpool",
 * see apiWorker.js), as /before-migration.db. Only the latest one is kept: each slot of that storage is a file, and
 * there are only a few. It's for undoing a broken upgrade by hand; Settings > Save backup stays the real backup.
 *
 * If the copy can't be made (a browser with the database in memory, no room left), the upgrade goes on anyway: each
 * migration runs in one transaction, so a failing one changes nothing, and a phone stuck on an old database
 * (every page showing an error) is worse than an upgrade without a spare copy.
 */

const COPY_FILE = "/before-migration.db";
let databasePool = null; // the opfs-sahpool storage, given by apiWorker.js; null when the database is in memory

const useDatabasePool = (pool) => { databasePool = pool; };

function saveCopyBeforeMigrating(db, fromVersion, toVersion) {
  if (!databasePool) return console.warn(`Upgrading the database from version ${fromVersion} to ${toVersion} without a copy: it's in memory`);
  try {
    if (databasePool.getFileNames().includes(COPY_FILE)) databasePool.unlink(COPY_FILE); // VACUUM INTO needs a new file
    db.prepare(`VACUUM INTO ?`).run(COPY_FILE);
    console.log(`Database copy saved to ${COPY_FILE} (version ${fromVersion}, before upgrading to ${toVersion})`);
  } catch (error) {
    console.warn(`Upgrading the database from version ${fromVersion} to ${toVersion} without a copy: ${error.message}`);
  }
}

module.exports = { saveCopyBeforeMigrating, useDatabasePool };
