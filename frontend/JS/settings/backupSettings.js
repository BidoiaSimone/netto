// ---- Settings > backups: automatic backup status, open the folder, restore a JSON backup ----
// (The "Download backup (JSON)" button is a plain link to /export in Home.html.)

import { elementById } from "../core/domHelpers.js";
import { getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { runThenReloadAllData } from "../core/dataRefresh.js";

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
  statusLine.textContent = `Automatic backup every day: last one ${describeBackupDay(savedAt)} at ${savedTime} · the last ${backupStatus.keep} are kept in backend/db/backups (${backupStatus.count} now). A downloaded JSON backup goes to Downloads, with a copy there too.`;
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
  const confirmation = `Replace ALL current data with this backup?\n\n${countRows("accounts")} accounts, ${countRows("investments")} investments, ${countRows("transactions")} transactions.\n\nA copy of the current data is saved first in backend/db/backups.`;
  if (!confirm(confirmation)) return;
  runThenReloadAllData(async () => {
    const importedCounts = await callApi("/import", { method: "POST", body: backupData });
    alert(`Backup restored: ${importedCounts.accounts} accounts, ${importedCounts.investments} investments, ${importedCounts.categories} categories, ${importedCounts.transactions} transactions, ${importedCounts.tags} tags.`);
  });
}

export function initializeBackupSettings() {
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
