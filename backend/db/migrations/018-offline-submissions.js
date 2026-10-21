/* MIGRATION 18. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 18: transactions added on the phone while the Mac couldn't be reached ----
// The phone keeps them and sends them once the server answers again (frontend/JS/core/offlineQueue.js).
// (Every new transaction from the dialog carries an offline_id, even when the server answers at once: a first try
// that times out after the server saved it is then recognised when it's sent again.)
// Sending can be cut off after the server saved the transaction but before the phone heard back (the Mac goes
// to sleep, the train enters a tunnel): the phone then sends it again. Each one carries an id the phone made up
// (offline_id), and this table remembers the ids already received, so the second time nothing is added twice.
// transaction_id: ON DELETE SET NULL, so deleting the transaction later doesn't let a late copy add it back.
function createOfflineSubmissionsTable(db) {
  db.exec(`
    CREATE TABLE offline_submissions (
      offline_id TEXT PRIMARY KEY,
      transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      received_at TEXT NOT NULL
    ) WITHOUT ROWID;
  `);
}

module.exports = createOfflineSubmissionsTable;
