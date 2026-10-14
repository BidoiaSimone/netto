/* MIGRATION 2. Already applied to existing databases: never edit it, add a new migration instead.
 * (Function name before the refactor: idsCentsAndCalculatedBalances) */

// ---- 2: integer account ids, money in cents, balances calculated instead of stored ----
// SQLite can't change a column's type or a table's primary key, so both tables are rebuilt:
// create the new table, copy the rows over, drop the old one, rename the new one.
//
// accounts.amount (a running total every transaction updated) becomes opening_balance: what the
// account held before any of its transactions. It is worked out backwards so every balance stays
// exactly what it was:  opening = current amount - money in + money out.
function convertToIntegerIdsAndCents(db) {
  db.exec(`
    CREATE TABLE accounts_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      kind TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash', 'bank', 'savings', 'asset')),
      opening_balance INTEGER NOT NULL DEFAULT 0,  -- cents; negative = a debt
      open_date TEXT NOT NULL,
      last_reconciled TEXT
    );

    INSERT INTO accounts_new (name, kind, opening_balance, open_date, last_reconciled)
      SELECT a.name, a.kind,
             CAST(ROUND(a.amount * 100) AS INTEGER)
               - COALESCE((SELECT SUM(CAST(ROUND(t.amount * 100) AS INTEGER)) FROM transactions t WHERE t.to_account = a.name), 0)
               + COALESCE((SELECT SUM(CAST(ROUND(t.amount * 100) AS INTEGER)) FROM transactions t WHERE t.from_account = a.name), 0),
             a.open_date, a.last_reconciled
      FROM accounts a
      ORDER BY a.rowid;  -- keeps the creation order (the Assets pie colors depend on it)

    -- The references point at "accounts", the name accounts_new will have once renamed.
    -- No ON DELETE: an account that still has transactions can't be deleted.
    CREATE TABLE transactions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_account_id INTEGER REFERENCES accounts(id),
      to_account_id INTEGER REFERENCES accounts(id),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'movement', 'adjustment')),
      amount INTEGER NOT NULL CHECK (amount > 0),  -- cents, always positive: the direction is from -> to
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      description TEXT,
      date TEXT NOT NULL,
      CHECK (from_account_id IS NOT NULL OR to_account_id IS NOT NULL),
      CHECK (from_account_id IS NOT to_account_id)
    );

    INSERT INTO transactions_new (id, from_account_id, to_account_id, type, amount, category_id, description, date)
      SELECT t.id,
             (SELECT id FROM accounts_new WHERE name = t.from_account),
             (SELECT id FROM accounts_new WHERE name = t.to_account),
             t.type, CAST(ROUND(t.amount * 100) AS INTEGER), t.category_id, t.description, t.date
      FROM transactions t;

    DROP TABLE transactions;
    DROP TABLE accounts;
    ALTER TABLE accounts_new RENAME TO accounts;
    ALTER TABLE transactions_new RENAME TO transactions;

    -- Balances are summed from these columns, so look-ups by account must be fast
    CREATE INDEX transactions_from ON transactions(from_account_id);
    CREATE INDEX transactions_to ON transactions(to_account_id);
    CREATE INDEX transactions_date ON transactions(date);

    -- The balance of every account, always in step with its transactions (cents)
    CREATE VIEW account_balances AS
      SELECT a.*,
             a.opening_balance
               + COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = a.id), 0)
               - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = a.id), 0) AS balance
      FROM accounts a;
  `);

  // A transaction whose account name matched no account would now have a NULL id
  // and fail the CHECK above; this catches the case where only one side was lost.
  const lost = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE (from_account_id IS NULL AND type IN ('expense', 'movement'))
       OR (to_account_id IS NULL AND type IN ('income', 'movement'))
  `).get().n;
  if (lost) throw new Error(`${lost} transaction(s) point to an account that doesn't exist`);
}

module.exports = convertToIntegerIdsAndCents;
