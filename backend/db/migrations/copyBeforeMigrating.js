/* THE COPY SAVED BEFORE A DATABASE UPGRADE (used by migrationRunner.js)
 * A consistent copy of the whole database in backend/db/backups/, so an upgrade can always be undone by hand.
 * In the PWA there is no such folder: pwa/build.mjs puts pwa/browserBackend/standIns/copyBeforeMigrating.js in its place.
 */

const fs = require("fs");
const path = require("path");
const { getTimestampForFileName } = require("../../server/utils/localDates.js");

function saveCopyBeforeMigrating(db, fromVersion, toVersion, backupDirectory) {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupFile = path.join(backupDirectory, `before-migration-v${fromVersion}-to-v${toVersion}-${getTimestampForFileName()}.db`);
  db.prepare(`VACUUM INTO ?`).run(backupFile); // a consistent copy of the whole database, in one statement
  console.log(`Database backup saved to ${backupFile}`);
}

module.exports = { saveCopyBeforeMigrating };
