/* MIGRATION 6. Already applied to existing databases: never edit it, add a new migration instead.
 * (Function name before the refactor: closedAccounts) */

// ---- 6: accounts can be closed ----
// An account with history can't be deleted (its transactions point to it), but it can be closed:
// hidden from the Assets list and the pickers, its history kept. Only at a zero balance (routes/accountRoutes.js).
function allowClosingAccounts(db) {
  db.exec(`ALTER TABLE accounts ADD COLUMN closed_at TEXT;  -- YYYY-MM-DD, NULL while open`);
}

module.exports = allowClosingAccounts;
