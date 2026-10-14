/* THE BACKUPS FOLDER (backend/db/backups)
 * Small helpers for the Settings page: keep a copy of a downloaded JSON backup there,
 * save a safety copy of the database before an import, and show the folder in Finder.
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const db = require("../../db/databaseConnection.js");
const { BACKUPS_DIRECTORY } = require("../../config/projectPaths.js");
const { getTimestampForFileName } = require("../utils/localDates.js");

// "Download backup (JSON)" also keeps a copy here, so every kind of backup is in this one folder
// (the browser's own download goes to Downloads, a web page can't choose where)
function saveJsonBackupCopy(fileName, backupData) {
  fs.mkdirSync(BACKUPS_DIRECTORY, { recursive: true });
  fs.writeFileSync(path.join(BACKUPS_DIRECTORY, fileName), JSON.stringify(backupData, null, 2));
}

// The current database, saved before an import replaces everything, so an import can always be undone
async function saveDatabaseCopyBeforeImport() {
  fs.mkdirSync(BACKUPS_DIRECTORY, { recursive: true });
  await db.backup(path.join(BACKUPS_DIRECTORY, `before-import-${getTimestampForFileName()}.db`));
}

// Settings > Open backups folder: Finder shows the folder. The server runs on the Mac itself, so it can.
// execFile with a fixed path: nothing from the request reaches the command.
function revealBackupsFolderInFinder() {
  fs.mkdirSync(BACKUPS_DIRECTORY, { recursive: true });
  return new Promise((resolve, reject) => {
    if (process.platform !== "darwin") return reject(new Error(`Opening folders only works on a Mac. The backups are in ${BACKUPS_DIRECTORY}`));
    execFile("open", [BACKUPS_DIRECTORY], (error) => (error ? reject(error) : resolve(BACKUPS_DIRECTORY)));
  });
}

module.exports = { saveJsonBackupCopy, saveDatabaseCopyBeforeImport, revealBackupsFolderInFinder };
