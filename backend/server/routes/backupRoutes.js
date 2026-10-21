/* BACKUPS (Settings page): status of the automatic backups, open the folder,
 * download a full JSON backup, restore one.
 */

const express = require("express");
const chalk = require("chalk");
const { getDailyBackupStatus, copyNewestBackupOffsite } = require("../services/automaticDailyBackups.js");
const { saveJsonBackupCopy, saveDatabaseCopyBeforeImport, revealBackupsFolderInFinder } = require("../services/backupsFolder.js");
const { buildJsonBackupFileName, buildFullJsonBackup } = require("../services/jsonBackupExport.js");
const { isValidBackupShape, replaceAllDataWithBackup, countImportedRows } = require("../services/jsonBackupImport.js");

const router = express.Router();

// The automatic daily backups, for the Settings page
// (also copies the newest backup to iCloud Drive if it isn't there yet: the setting may have just been turned on)
router.get("/backups", function getBackupStatus(request, response) {
  copyNewestBackupOffsite();
  response.json(getDailyBackupStatus());
});

// Settings > Open backups folder: opens backend/db/backups in Finder
router.post("/backups/open", async function openBackupsFolder(request, response) {
  try {
    response.json({ folder: await revealBackupsFolderInFinder() });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

// Full backup of every table as a downloadable JSON file.
// A copy is also saved in backend/db/backups (same name), next to the automatic backups.
router.get("/export", function downloadJsonBackup(request, response) {
  const fileName = buildJsonBackupFileName();
  const backupData = buildFullJsonBackup();
  try {
    saveJsonBackupCopy(fileName, backupData);
  } catch (error) {
    console.error(`Could not keep a copy of the JSON backup: ${error.message}`); // the download still works
  }
  response.attachment(fileName);
  response.json(backupData);
});

// Restore a JSON backup made by /export. Replaces ALL current data.
// The current database is first saved to backend/db/backups/ so an import can always be undone.
router.post("/import", async function restoreJsonBackup(request, response) {
  const backupData = request.body;
  if (!isValidBackupShape(backupData)) {
    return response.status(400).json({ error: "Not a valid backup: expected accounts, investments and transactions lists." });
  }

  try {
    await saveDatabaseCopyBeforeImport();
  } catch (error) {
    return response.status(500).json({ error: "Could not save a safety copy, nothing was imported: " + error.message });
  }

  try {
    replaceAllDataWithBackup(backupData); // all or nothing: on any bad row the old data stays untouched
  } catch (error) {
    return response.status(400).json({ error: "Import failed, your data was not changed: " + error.message });
  }

  const importedCounts = countImportedRows();
  console.log(chalk.green(`Imported ${importedCounts.accounts} accounts, ${importedCounts.investments} investments, ${importedCounts.categories} categories, ${importedCounts.transactions} transactions`));
  response.json(importedCounts);
});

module.exports = router;
