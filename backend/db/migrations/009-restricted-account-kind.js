/* MIGRATION 9. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 9: a 'restricted' account kind ----
// Accounts are grouped by how liquid they are (config/accountKinds.js), and meal vouchers and the like
// need a kind of their own: money, but only spendable on some things. The kind column only accepts the
// kinds listed in its CHECK, which SQLite can't change, so the table is rebuilt with the same columns,
// rows and ids: everything pointing to an account by id keeps working.
//
// The triggers on transactions (migration 3) mention `accounts`. A modern SQLite checks every trigger when
// a table is renamed and would stop on them, because between DROP and RENAME no table has that name;
// legacy_alter_table switches that check off for the rename only.
function addRestrictedAccountKind(db) {
  db.exec(`
    CREATE TABLE accounts_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      kind TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash', 'bank', 'savings', 'restricted', 'asset')),
      opening_balance INTEGER NOT NULL DEFAULT 0,  -- cents; negative = a debt
      open_date TEXT NOT NULL,
      last_reconciled TEXT,
      balance INTEGER NOT NULL DEFAULT 0,          -- cents, kept up to date by the triggers on transactions
      closed_at TEXT                               -- YYYY-MM-DD, NULL while open
    );
    INSERT INTO accounts_new (id, name, kind, opening_balance, open_date, last_reconciled, balance, closed_at)
      SELECT id, name, kind, opening_balance, open_date, last_reconciled, balance, closed_at FROM accounts;
    DROP TABLE accounts;
  `);
  db.pragma("legacy_alter_table = ON");
  try {
    db.exec(`ALTER TABLE accounts_new RENAME TO accounts;`);
  } finally {
    db.pragma("legacy_alter_table = OFF");
  }
}

module.exports = addRestrictedAccountKind;
