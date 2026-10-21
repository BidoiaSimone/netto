// ---- Settings > backups: automatic backup status, open the folder, restore a JSON backup ----
// (The "Download backup (JSON)" button is a plain link to /export in Home.html.)

import { elementById } from "../core/domHelpers.js";
import { getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { isLightEdition } from "../core/edition.js";

const BACKUPS_FOLDER = isLightEdition ? "backend/db/light-backups" : "backend/db/backups"; // netto light keeps its own (config/projectPaths.js)
import { showErrorMessage } from "../core/errorBanner.js";
import { runThenReloadAllData } from "../core/dataRefresh.js";
import { saveAppSetting } from "../core/appSettings.js";

const MILLISECONDS_PER_DAY = 864e5;

// "today", "yesterday" or the date, Italian style
function describeBackupDay(savedAt) {
  const savedDay = savedAt.toLocaleDateString("sv-SE");
  const yesterday = new Date(Date.now() - MILLISECONDS_PER_DAY).toLocaleDateString("sv-SE");
  if (savedDay === getTodayAsLocalDate()) return "today";
  if (savedDay === yesterday) return "yesterday";
  return savedAt.toLocaleDateString("it-IT");
}

// When the last automatic daily backup was made (services/automaticDailyBackups.js on the server)
export async function loadBackupStatus() {
  const backupStatus = await callApi("/backups");
  renderOffsiteStatus(backupStatus.offsite);
  const statusLine = elementById("backup-status");
  statusLine.classList.toggle("neg", Boolean(backupStatus.error));
  if (backupStatus.error) {
    statusLine.textContent = `Automatic backup failed: ${backupStatus.error}`;
    return;
  }
  if (!backupStatus.last) {
    statusLine.textContent = "Automatic backups: the first one is made shortly after the server starts.";
    return;
  }
  const savedAt = new Date(backupStatus.last.saved_at);
  const savedTime = savedAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  statusLine.textContent = `Automatic backup every day: last one ${describeBackupDay(savedAt)} at ${savedTime} · the last ${backupStatus.keep} are kept in ${BACKUPS_FOLDER} (${backupStatus.count} now).`;
}

// The copy in iCloud Drive (on by default): the tick box, and where the copies are
function renderOffsiteStatus(offsite) {
  const toggle = elementById("backup-offsite-toggle");
  const statusLine = elementById("backup-offsite-status");
  toggle.checked = offsite.enabled;
  toggle.disabled = !offsite.available;
  statusLine.classList.toggle("neg", Boolean(offsite.error));
  if (!offsite.available) statusLine.textContent = "iCloud Drive isn't on for this Mac (System Settings → your name → iCloud → iCloud Drive), so the backups stay only on this Mac.";
  else if (offsite.error) statusLine.textContent = `Copying to iCloud Drive failed: ${offsite.error}`;
  else if (!offsite.enabled) statusLine.textContent = "Off: the backups are only on this Mac.";
  else statusLine.textContent = offsite.last
    ? `${offsite.count} cop${offsite.count === 1 ? "y" : "ies"} in iCloud Drive, newest ${offsite.last.slice(5, 15)}.`
    : "The first copy is made with the next daily backup.";
}

// Restore a backup made with "Download backup"
async function restoreBackupFromFile(file) {
  let backupData;
  try {
    backupData = JSON.parse(await file.text());
  } catch {
    return showErrorMessage("That file is not valid JSON.");
  }
  const countRows = (listName) => (Array.isArray(backupData[listName]) ? backupData[listName].length : 0);
  const confirmation = `Replace ALL current data with this backup?\n\n${countRows("accounts")} accounts, ${countRows("investments")} investments, ${countRows("transactions")} transactions.\n\nA copy of the current data is saved first in ${BACKUPS_FOLDER}.`;
  if (!confirm(confirmation)) return;
  runThenReloadAllData(async () => {
    const importedCounts = await callApi("/import", { method: "POST", body: backupData });
    alert(`Backup restored: ${importedCounts.accounts} accounts, ${importedCounts.investments} investments, ${importedCounts.categories} categories, ${importedCounts.transactions} transactions, ${importedCounts.tags} tags.`);
  });
}

export function initializeBackupSettings() {
  elementById("backup-offsite-toggle").addEventListener("change", async (event) => {
    try {
      await saveAppSetting("backup_copy_offsite", event.target.checked ? 1 : 0);
      await loadBackupStatus(); // turning it on makes the first copy right away
    } catch (error) {
      showErrorMessage(error.message);
    }
  });

  // Opens backend/db/backups in Finder (done by the server, which runs on this Mac)
  elementById("open-backups").addEventListener("click", async () => {
    try {
      await callApi("/backups/open", { method: "POST" });
    } catch (error) {
      showErrorMessage(error.message);
    }
  });

  elementById("importBtn").addEventListener("click", () => elementById("importFile").click());
  elementById("importFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = ""; // lets you pick the same file again later
    if (file) await restoreBackupFromFile(file);
  });
}
