/* AUTOMATIC DAILY BACKUPS
 * Once a day the server copies the whole database into backend/db/backups/auto-YYYY-MM-DD.db
 * and keeps only the last NUMBER_OF_DAILY_BACKUPS_KEPT of them. It checks when it starts and then
 * every hour, so a day the Mac was asleep or off still gets its copy as soon as the server is
 * running again.
 *
 * db.backup() is SQLite's own online backup: it makes a consistent copy even while the app is
 * being used. The copy is written under a temporary name and renamed when complete, so a backup
 * cut short (power off...) never looks like a good one.
 *
 * Only the auto-*.db files are ever deleted. The copies made before a database upgrade or an
 * import (before-migration-*, before-import-*) are never touched.
 *
 * To restore one: stop the server (bash scripts/service.sh stop), copy the backup over
 * backend/db/money.db, delete money.db-wal and money.db-shm if present, and start it again.
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const db = require("../../db/databaseConnection.js");
const { BACKUPS_DIRECTORY } = require("../../config/projectPaths.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");

const NUMBER_OF_DAILY_BACKUPS_KEPT = 14; // two weeks
const CHECK_INTERVAL_MILLISECONDS = 60 * 60 * 1000;
const DAILY_BACKUP_FILE_NAME_PATTERN = /^auto-\d{4}-\d{2}-\d{2}\.db$/;

let isBackupRunning = false;
let lastBackupErrorMessage = null;

// The date in the name sorts them oldest first
function listDailyBackupFiles() {
  try {
    return fs.readdirSync(BACKUPS_DIRECTORY).filter((fileName) => DAILY_BACKUP_FILE_NAME_PATTERN.test(fileName)).sort();
  } catch {
    return []; // no backups folder yet
  }
}

async function makeTodaysBackupIfMissing() {
  if (isBackupRunning) return;
  isBackupRunning = true;
  try {
    fs.mkdirSync(BACKUPS_DIRECTORY, { recursive: true });
    const todaysBackupFile = path.join(BACKUPS_DIRECTORY, `auto-${getTodayAsLocalDate()}.db`);
    if (!fs.existsSync(todaysBackupFile)) await writeBackupSafely(todaysBackupFile);
    deleteDailyBackupsBeyondTheKeptOnes();
    lastBackupErrorMessage = null;
  } catch (error) {
    lastBackupErrorMessage = error.message;
    console.error(`Automatic backup failed: ${error.message}`);
  } finally {
    isBackupRunning = false;
  }
}

async function writeBackupSafely(finalBackupFile) {
  const partialBackupFile = finalBackupFile + ".part";
  await db.backup(partialBackupFile);
  // The copy inherits the live database's WAL mode, which makes SQLite add -wal/-shm files next to
  // it whenever it's opened. Switched to the classic mode, a backup stays one self-contained file.
  const backupCopy = new Database(partialBackupFile);
  backupCopy.pragma("journal_mode = DELETE");
  backupCopy.close();
  fs.renameSync(partialBackupFile, finalBackupFile);
  console.log(`Automatic backup saved: ${path.basename(finalBackupFile)}`);
}

// Keeps the newest NUMBER_OF_DAILY_BACKUPS_KEPT, deletes the older ones
function deleteDailyBackupsBeyondTheKeptOnes() {
  for (const oldBackupFile of listDailyBackupFiles().slice(0, -NUMBER_OF_DAILY_BACKUPS_KEPT)) {
    for (const fileName of [oldBackupFile, oldBackupFile + "-wal", oldBackupFile + "-shm"]) {
      fs.rmSync(path.join(BACKUPS_DIRECTORY, fileName), { force: true });
    }
  }
}

// Leftovers of a backup that was cut short
function deleteUnfinishedBackups() {
  const fileNames = fs.existsSync(BACKUPS_DIRECTORY) ? fs.readdirSync(BACKUPS_DIRECTORY) : [];
  for (const fileName of fileNames) {
    if (fileName.startsWith("auto-") && fileName.includes(".db.part")) fs.rmSync(path.join(BACKUPS_DIRECTORY, fileName), { force: true });
  }
}

function startAutomaticDailyBackups() {
  deleteUnfinishedBackups();
  makeTodaysBackupIfMissing();
  setInterval(makeTodaysBackupIfMissing, CHECK_INTERVAL_MILLISECONDS).unref();
}

// For the Settings page: the newest automatic backup, how many are kept, and the last error if any
function getDailyBackupStatus() {
  const backupFiles = listDailyBackupFiles();
  const newestBackupFile = backupFiles[backupFiles.length - 1];
  return {
    keep: NUMBER_OF_DAILY_BACKUPS_KEPT,
    count: backupFiles.length,
    last: newestBackupFile
      ? { file: newestBackupFile, saved_at: fs.statSync(path.join(BACKUPS_DIRECTORY, newestBackupFile)).mtime.toISOString() }
      : null,
    error: lastBackupErrorMessage,
  };
}

module.exports = { startAutomaticDailyBackups, getDailyBackupStatus, makeTodaysBackupIfMissing, NUMBER_OF_DAILY_BACKUPS_KEPT };
