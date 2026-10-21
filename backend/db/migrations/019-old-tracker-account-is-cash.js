/* MIGRATION 19. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 19: the "Old tracker" account (the history imported from the old spreadsheet) is not a bank account ----
// The first version of the import (services/oldTrackerImport.js) opened it as a current account ('bank'). The old
// tracker was a spreadsheet, not a bank: as 'bank' the Statements would estimate an imposta di bollo on it for the
// months before netto. Cash has no stamp duty. (The import now opens it as 'cash' itself.)
function makeOldTrackerAccountCash(db) {
  db.prepare(`UPDATE accounts SET kind = 'cash' WHERE name = 'Old tracker' AND kind = 'bank'`).run();
}

module.exports = makeOldTrackerAccountCash;
