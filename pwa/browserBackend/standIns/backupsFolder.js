/* THE BACKUPS FOLDER IN THE BROWSER: stands in for backend/server/services/backupsFolder.js
 * On the Mac every backup also lands in backend/db/backups. A web page has no folder of its own to write to, so in
 * the PWA the backup the user saves (Settings > Save backup, to iCloud Drive through the share sheet) is the only
 * copy: nothing is kept here, and the page warns before a restore replaces data (settings/backupSettings.js).
 */

const saveJsonBackupCopy = () => {};
const saveDatabaseCopyBeforeImport = () => Promise.resolve();
const revealBackupsFolderInFinder = () => Promise.reject(new Error("There's no backups folder in the browser"));

module.exports = { saveJsonBackupCopy, saveDatabaseCopyBeforeImport, revealBackupsFolderInFinder };
