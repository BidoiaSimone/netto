// ---- Settings > backups: automatic backup status, open the folder, restore a JSON backup ----
// (The "Download backup (JSON)" button is a plain link to /export in Home.html.)
//
// The PWA (runsWithoutServer) has no Mac and no backups folder: the data is only on this device. "Save backup…"
// makes the same JSON and hands it to the share sheet, where the iPhone offers Save to Files → iCloud Drive (a web
// page can't choose a folder itself); without a share sheet it's a normal download. When it was last saved is kept
// on this device, and after BACKUP_REMINDER_DAYS without one a reminder offers to save it in one tap.

import { elementById } from "../core/domHelpers.js";
import { getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { isLightEdition, runsWithoutServer } from "../core/edition.js";
import { callLocalApi } from "../core/localApi.js";
import { showToast } from "../core/toast.js";

const BACKUPS_FOLDER = isLightEdition ? "backend/db/light-backups" : "backend/db/backups"; // netto light keeps its own (config/projectPaths.js)
import { showErrorMessage } from "../core/errorBanner.js";
import { runThenReloadAllData } from "../core/dataRefresh.js";
import { saveAppSetting } from "../core/appSettings.js";

const MILLISECONDS_PER_DAY = 864e5;
const BACKUP_REMINDER_DAYS = 7;
const LAST_SAVED_KEY = "backupSavedAt";        // localStorage: when "Save backup…" last saved one (the PWA)
const REMINDER_SNOOZED_KEY = "backupReminderSnoozedOn"; // localStorage: the day "Later" was pressed
let reminderShownThisVisit = false;

const readLocal = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

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
  if (runsWithoutServer) return renderBackupStatusOfThisDevice();
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
  const safetyCopy = runsWithoutServer
    ? "The data on this device is replaced and not kept: if you might want it back, cancel and Save backup first."
    : `A copy of the current data is saved first in ${BACKUPS_FOLDER}.`;
  const confirmation = `Replace ALL current data with this backup?\n\n${countRows("accounts")} accounts, ${countRows("investments")} investments, ${countRows("transactions")} transactions.\n\n${safetyCopy}`;
  if (!confirm(confirmation)) return;
  runThenReloadAllData(async () => {
    const importedCounts = await callApi("/import", { method: "POST", body: backupData });
    alert(`Backup restored: ${importedCounts.accounts} accounts, ${importedCounts.investments} investments, ${importedCounts.categories} categories, ${importedCounts.transactions} transactions, ${importedCounts.tags} tags.`);
  });
}

// ---- the PWA's backups ----

const daysSince = (isoDate) => Math.floor((Date.now() - new Date(isoDate).getTime()) / MILLISECONDS_PER_DAY);

// The same JSON /export answers, as a file named like the Mac's downloads
async function makeBackupFile() {
  const answer = await callLocalApi("GET", "/export");
  if (answer.status >= 400) throw new Error((answer.body && answer.body.error) || "Could not make the backup");
  const fileName = /filename="([^"]+)"/.exec(answer.headers["content-disposition"] || "")?.[1] || "netto-backup.json";
  return new File([JSON.stringify(answer.body, null, 2)], fileName, { type: "application/json" });
}

function downloadFile(file) {
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

// The share sheet when there is one (iPhone: Save to Files), a download otherwise. True when it was saved.
async function handOverBackupFile(file) {
  if (!navigator.canShare?.({ files: [file] })) {
    downloadFile(file);
    return true;
  }
  try {
    await navigator.share({ files: [file] });
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false; // closed the share sheet
    if (error.name === "NotAllowedError") {
      // Safari wants the share sheet opened right after a tap, and making the file took too long: one more tap
      showToast("Your backup is ready", [{ label: "Save", onClick: () => handOverBackupFile(file).then(noteBackupSaved) }], 15000);
      return false;
    }
    throw error;
  }
}

function noteBackupSaved(wasSaved) {
  if (!wasSaved) return;
  writeLocal(LAST_SAVED_KEY, new Date().toISOString());
  renderBackupStatusOfThisDevice();
}

async function saveBackupFromThisDevice() {
  try {
    noteBackupSaved(await handOverBackupFile(await makeBackupFile()));
  } catch (error) {
    showErrorMessage(`Backup not saved: ${error.message}`);
  }
}

// Settings: when the last one was saved; and, past BACKUP_REMINDER_DAYS, the reminder (once a visit, not after "Later" today)
async function renderBackupStatusOfThisDevice() {
  const savedAt = readLocal(LAST_SAVED_KEY);
  const statusLine = elementById("backup-device-status");
  const isOverdue = !savedAt || daysSince(savedAt) >= BACKUP_REMINDER_DAYS;
  statusLine.classList.toggle("neg", isOverdue);
  statusLine.textContent = savedAt
    ? `Last backup saved ${describeBackupDay(new Date(savedAt))}${daysSince(savedAt) > 1 ? ` (${daysSince(savedAt)} days ago)` : ""}.`
    : "No backup saved from this device yet.";

  if (!isOverdue || reminderShownThisVisit || readLocal(REMINDER_SNOOZED_KEY) === getTodayAsLocalDate()) return;
  const accounts = await callApi("/accounts").catch(() => []);
  if (!accounts.length) return; // nothing to lose yet
  reminderShownThisVisit = true;
  showToast(savedAt ? `No backup for ${daysSince(savedAt)} days` : "Your data is only on this device", [
    { label: "Save backup", onClick: saveBackupFromThisDevice },
    { label: "Later", onClick: () => writeLocal(REMINDER_SNOOZED_KEY, getTodayAsLocalDate()) },
  ], 20000);
}

export function initializeBackupSettings() {
  elementById("save-backup").addEventListener("click", saveBackupFromThisDevice);
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

  elementById("importFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = ""; // lets you pick the same file again later
    if (file) await restoreBackupFromFile(file);
  });
}
