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
 * A COPY OFF THIS MAC: each daily backup is also copied to "netto backups" in iCloud Drive (the last
 * NUMBER_OF_DAILY_BACKUPS_KEPT there too), so a stolen or broken Mac doesn't take the data with it. Only when
 * iCloud Drive exists on this Mac, and the setting backup_copy_offsite is on (Settings > Backups, on by default).
 * A copy that fails (iCloud full, folder not allowed) is reported on the Settings page; the local backup is
 * never affected by it.
 *
 * To restore one: stop the server (bash scripts/service.sh stop), copy the backup over
 * backend/db/money.db, delete money.db-wal and money.db-shm if present, and start it again.
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const db = require("../../db/databaseConnection.js");
const { BACKUPS_DIRECTORY, OFFSITE_BACKUPS_DIRECTORY, OFFSITE_BACKUPS_PARENT_DIRECTORY } = require("../../config/projectPaths.js");
const { readSetting } = require("./appSettings.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");

const NUMBER_OF_DAILY_BACKUPS_KEPT = 14; // two weeks
const CHECK_INTERVAL_MILLISECONDS = 60 * 60 * 1000;
const DAILY_BACKUP_FILE_NAME_PATTERN = /^auto-\d{4}-\d{2}-\d{2}\.db$/;

let isBackupRunning = false;
let lastBackupErrorMessage = null;
let lastOffsiteErrorMessage = null;

// The date in the name sorts them oldest first
function listDailyBackupFiles(directory = BACKUPS_DIRECTORY) {
  try {
    return fs.readdirSync(directory).filter((fileName) => DAILY_BACKUP_FILE_NAME_PATTERN.test(fileName)).sort();
  } catch {
    return []; // no backups folder yet
  }
}

const isOffsiteCopyOn = () => readSetting("backup_copy_offsite") === 1 && fs.existsSync(OFFSITE_BACKUPS_PARENT_DIRECTORY);

// The newest local daily backup, copied to the off-Mac folder if it isn't there yet; the oldest ones there
// deleted like the local ones. Copied under a temporary name and renamed, like the local backup.
function copyNewestBackupOffsite() {
  if (!isOffsiteCopyOn()) return;
  try {
    const newestBackupFile = listDailyBackupFiles().at(-1);
    if (!newestBackupFile) return;
    fs.mkdirSync(OFFSITE_BACKUPS_DIRECTORY, { recursive: true });
    const offsiteFile = path.join(OFFSITE_BACKUPS_DIRECTORY, newestBackupFile);
    if (!fs.existsSync(offsiteFile)) {
      fs.copyFileSync(path.join(BACKUPS_DIRECTORY, newestBackupFile), offsiteFile + ".part");
      fs.renameSync(offsiteFile + ".part", offsiteFile);
      console.log(`Backup copied to ${OFFSITE_BACKUPS_DIRECTORY}`);
    }
    for (const oldFile of listDailyBackupFiles(OFFSITE_BACKUPS_DIRECTORY).slice(0, -NUMBER_OF_DAILY_BACKUPS_KEPT)) {
      fs.rmSync(path.join(OFFSITE_BACKUPS_DIRECTORY, oldFile), { force: true });
    }
    lastOffsiteErrorMessage = null;
  } catch (error) {
    lastOffsiteErrorMessage = error.message;
    console.error(`Copying the backup to ${OFFSITE_BACKUPS_DIRECTORY} failed: ${error.message}`);
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
    copyNewestBackupOffsite(); // also when today's local one already existed: the setting may have just been turned on
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
    offsite: {
      available: fs.existsSync(OFFSITE_BACKUPS_PARENT_DIRECTORY), // iCloud Drive exists on this Mac
      enabled: readSetting("backup_copy_offsite") === 1,          // the setting (Settings > Backups)
      on: isOffsiteCopyOn(),
      folder: OFFSITE_BACKUPS_DIRECTORY,
      count: listDailyBackupFiles(OFFSITE_BACKUPS_DIRECTORY).length,
      last: listDailyBackupFiles(OFFSITE_BACKUPS_DIRECTORY).at(-1) ?? null,
      error: lastOffsiteErrorMessage,
    },
  };
}

module.exports = { startAutomaticDailyBackups, getDailyBackupStatus, makeTodaysBackupIfMissing, copyNewestBackupOffsite, NUMBER_OF_DAILY_BACKUPS_KEPT };
