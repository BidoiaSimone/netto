/* THE BACKUP COPY OFF THE MAC (services/automaticDailyBackups.js, setting backup_copy_offsite)
 * In the tests "iCloud Drive" is a temporary folder (helpers/testEnvironment.js): only made when its parent exists,
 * only when the setting is on, never twice, and the oldest copies there are deleted like the local ones.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { startTestServer } = require("./helpers/testServer.js");
const { makeTodaysBackupIfMissing, copyNewestBackupOffsite, getDailyBackupStatus, NUMBER_OF_DAILY_BACKUPS_KEPT } = require("../backend/server/services/automaticDailyBackups.js");
const { BACKUPS_DIRECTORY, OFFSITE_BACKUPS_DIRECTORY, OFFSITE_BACKUPS_PARENT_DIRECTORY } = require("../backend/config/projectPaths.js");

openTestDatabase();
let callApi, stopServer;
before(async () => { ({ callApi, stopServer } = await startTestServer()); });
after(() => stopServer());

const offsiteFiles = () => (fs.existsSync(OFFSITE_BACKUPS_DIRECTORY) ? fs.readdirSync(OFFSITE_BACKUPS_DIRECTORY).sort() : []);

test("no iCloud Drive on this computer: nothing is copied, and nothing is created", async () => {
  assert.ok(!fs.existsSync(OFFSITE_BACKUPS_PARENT_DIRECTORY));
  await makeTodaysBackupIfMissing();
  assert.equal(getDailyBackupStatus().offsite.available, false);
  assert.ok(!fs.existsSync(OFFSITE_BACKUPS_PARENT_DIRECTORY));
});

test("with iCloud Drive: today's backup is copied there once; turned off, nothing more is copied", async () => {
  fs.mkdirSync(OFFSITE_BACKUPS_PARENT_DIRECTORY, { recursive: true });
  const localFiles = fs.readdirSync(BACKUPS_DIRECTORY).filter((name) => name.startsWith("auto-"));
  assert.equal(localFiles.length, 1);

  const status = (await callApi("GET", "/backups")).body; // the status call makes the missing copy
  assert.equal(status.offsite.on, true);
  assert.deepEqual(offsiteFiles(), localFiles);
  assert.deepEqual(fs.readFileSync(path.join(OFFSITE_BACKUPS_DIRECTORY, localFiles[0])), fs.readFileSync(path.join(BACKUPS_DIRECTORY, localFiles[0])));

  fs.rmSync(path.join(OFFSITE_BACKUPS_DIRECTORY, localFiles[0]));
  assert.equal((await callApi("PUT", "/settings", { backup_copy_offsite: 0 })).status, 200);
  copyNewestBackupOffsite();
  assert.deepEqual(offsiteFiles(), [], "off: not copied again");
  await callApi("PUT", "/settings", { backup_copy_offsite: 1 });
});

test("only the newest ones are kept there too", () => {
  for (let day = 1; day <= NUMBER_OF_DAILY_BACKUPS_KEPT + 3; day++) {
    fs.writeFileSync(path.join(OFFSITE_BACKUPS_DIRECTORY, `auto-2020-01-${String(day).padStart(2, "0")}.db`), "old");
  }
  copyNewestBackupOffsite();
  const kept = offsiteFiles();
  assert.equal(kept.length, NUMBER_OF_DAILY_BACKUPS_KEPT);
  assert.ok(!kept.includes("auto-2020-01-01.db"));
  assert.ok(kept.at(-1).startsWith("auto-20") && !kept.at(-1).startsWith("auto-2020"), "today's copy is among them");
});
