/* LIVE RELOAD
 * Saving a frontend file reloads every open page (a CSS file is swapped in place, no reload).
 * Backend changes restart the server (node --watch / nodemon); each start has a new boot id, so pages
 * reconnecting to /session see a different id and reload themselves too (see openWindowSessions.js).
 */

const fs = require("fs");
const path = require("path");
const { FRONTEND_DIRECTORY } = require("../../config/projectPaths.js");
const { sendEventToAllOpenWindows } = require("./openWindowSessions.js");

// Editors often write a file in several steps: wait for the last one before telling the pages
const WAIT_FOR_LAST_WRITE_MILLISECONDS = 150;

function startFrontendLiveReload() {
  let changedFiles = new Set();
  let notifyTimer = null;
  try {
    fs.watch(FRONTEND_DIRECTORY, { recursive: true }, (eventType, changedFile) => {
      if (!changedFile || path.basename(changedFile).startsWith(".")) return; // .DS_Store, editor temp files
      changedFiles.add(changedFile.split(path.sep).join("/"));
      clearTimeout(notifyTimer);
      notifyTimer = setTimeout(() => {
        const files = [...changedFiles];
        changedFiles = new Set();
        const onlyStylesChanged = files.every((file) => file.endsWith(".css"));
        sendEventToAllOpenWindows(onlyStylesChanged ? "css" : "reload", files);
      }, WAIT_FOR_LAST_WRITE_MILLISECONDS);
    });
  } catch (error) {
    console.warn("Live reload disabled:", error.message);
  }
}

module.exports = { startFrontendLiveReload };
