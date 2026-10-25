/* PROJECT PATHS IN THE BROWSER: stands in for backend/config/projectPaths.js
 * The database is "money.db" in this site's private storage (OPFS, see apiWorker.js); there is no project folder,
 * frontend folder or backups folder, so making the backups folder fails and callers report it as they already do.
 */

module.exports = {
  isProjectFolderStillThere: () => false,
  makeBackupsDirectory: () => { throw new Error("There's no backups folder in the browser: use Download backup (JSON)"); },
  PROJECT_ROOT_DIRECTORY: "/",
  FRONTEND_DIRECTORY: "/",
  DATABASE_FILE: "/money.db",
  BACKUPS_DIRECTORY: "/backups",
  OFFSITE_BACKUPS_DIRECTORY: "/offsite-backups",
  OFFSITE_BACKUPS_PARENT_DIRECTORY: "/",
};
