/* DATABASE SCHEMA, AS A LIST OF NUMBERED MIGRATIONS
 *
 * The schema is never edited in place. Each change is a new migration at the end of the list.
 * SQLite keeps the number of the last migration applied in `PRAGMA user_version`, so on startup
 * only the migrations the database hasn't seen yet are run, in order, each one all-or-nothing.
 * A fresh database simply runs all of them.
 *
 * Rules: never edit or reorder a migration that has already run on someone's database;
 * to change something, add a new one.
 *
 * Money is stored as INTEGER cents (12,34 € -> 1234): floats can't hold most decimal amounts
 * exactly (0.1 + 0.2 = 0.30000000000000004), and those errors add up over thousands of rows.
 * Conversion to and from euros happens only at the API boundary (backend/server/money.js).
 */

const fs = require("fs");
const path = require("path");

const migrations = [
  // ---- 1: the schema as it was before migrations existed ----
  // Databases from that time are all at user_version 0, whatever shape they are in, so this one
  // is written to work on all of them: IF NOT EXISTS for the tables, and the old one-time upgrade
  // from a free-text `category` column to category_id.
  function baseline(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_account TEXT,
        to_account TEXT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'movement', 'adjustment')),
        amount REAL NOT NULL CHECK (amount > 0),
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        description TEXT,
        date TEXT NOT NULL,
        CHECK (from_account IS NOT NULL OR to_account IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS investments (
        ticker TEXT PRIMARY KEY,
        amount_invested REAL NOT NULL,
        average_purchase_price REAL NOT NULL,
        shares REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        name TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        kind TEXT NOT NULL DEFAULT 'cash',
        open_date TEXT NOT NULL,
        last_reconciled TEXT
      );
    `);

    const cols = db.prepare(`PRAGMA table_info(transactions)`).all().map((c) => c.name);
    if (cols.includes("category") && !cols.includes("category_id")) {
      db.exec(`
        INSERT OR IGNORE INTO categories (name)
          SELECT DISTINCT TRIM(category) FROM transactions WHERE TRIM(COALESCE(category, '')) <> '';
        ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
        UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name = TRIM(transactions.category));
        ALTER TABLE transactions DROP COLUMN category;
      `);
    }
  },

  // ---- 2: integer account ids, money in cents, balances calculated instead of stored ----
  // SQLite can't change a column's type or a table's primary key, so both tables are rebuilt:
  // create the new table, copy the rows over, drop the old one, rename the new one.
  //
  // accounts.amount (a running total every transaction updated) becomes opening_balance: what the
  // account held before any of its transactions. It is worked out backwards so every balance stays
  // exactly what it was:  opening = current amount - money in + money out.
  function idsCentsAndCalculatedBalances(db) {
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
  },
  // ---- 3: the balance is stored in accounts again, kept up to date by triggers ----
  // So the database itself always shows what each account really holds (in a DB viewer, a copy
  // of the file...), without calculating anything. The triggers below are rules SQLite runs by
  // itself whenever a transaction is added, changed or deleted, wherever the change comes from
  // (a route, an import, a script), so the stored balance can't drift from the history.
  // opening_balance stays: it is the starting point checkBalances() uses to verify everything.
  function storedBalanceWithTriggers(db) {
    db.exec(`
      ALTER TABLE accounts ADD COLUMN balance INTEGER NOT NULL DEFAULT 0;  -- cents

      UPDATE accounts SET balance = opening_balance
        + COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = accounts.id), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = accounts.id), 0);

      DROP VIEW account_balances;

      -- A new transaction: money leaves the source and reaches the destination.
      -- (When an id is NULL, e.g. no source for an income, the UPDATE simply matches no account.)
      CREATE TRIGGER transactions_after_insert AFTER INSERT ON transactions BEGIN
        UPDATE accounts SET balance = balance - NEW.amount WHERE id = NEW.from_account_id;
        UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.to_account_id;
      END;

      -- A deleted transaction: undo it.
      CREATE TRIGGER transactions_after_delete AFTER DELETE ON transactions BEGIN
        UPDATE accounts SET balance = balance + OLD.amount WHERE id = OLD.from_account_id;
        UPDATE accounts SET balance = balance - OLD.amount WHERE id = OLD.to_account_id;
      END;

      -- An edited transaction (amount or accounts changed): undo the old version, apply the new one.
      CREATE TRIGGER transactions_after_update AFTER UPDATE OF amount, from_account_id, to_account_id ON transactions BEGIN
        UPDATE accounts SET balance = balance + OLD.amount WHERE id = OLD.from_account_id;
        UPDATE accounts SET balance = balance - OLD.amount WHERE id = OLD.to_account_id;
        UPDATE accounts SET balance = balance - NEW.amount WHERE id = NEW.from_account_id;
        UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.to_account_id;
      END;
    `);
  },
];

const LATEST = migrations.length;

// Runs the migrations this database hasn't had yet. Before touching a database that already
// has data, a copy is saved in backend/db/backups/ so an upgrade can always be undone by hand.
function migrate(db, { backupDir = path.join(__dirname, "backups") } = {}) {
  const current = db.pragma("user_version", { simple: true });
  if (current > LATEST) {
    throw new Error(`money.db is at version ${current}, but this code only knows up to ${LATEST}. Update the code (git pull).`);
  }
  if (current === LATEST) return;

  // sqlite_* tables are SQLite's own bookkeeping, not data
  const hasData = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get().n > 0;
  if (hasData && db.name !== ":memory:") {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(backupDir, `before-migration-v${current}-to-v${LATEST}-${stamp}.db`);
    db.prepare(`VACUUM INTO ?`).run(file); // a consistent copy of the whole database, in one statement
    console.log(`Database backup saved to ${file}`);
  }

  // Rebuilding tables means dropping tables that others reference, which the foreign key
  // check would refuse halfway through. It's switched off for the migration (it can only be
  // changed outside a transaction) and every reference is checked once at the end instead.
  const fkWasOn = db.pragma("foreign_keys", { simple: true });
  db.pragma("foreign_keys = OFF");
  try {
    for (let v = current + 1; v <= LATEST; v++) {
      db.transaction(() => {
        migrations[v - 1](db);
        const broken = db.pragma("foreign_key_check");
        if (broken.length) throw new Error(`migration ${v} left ${broken.length} broken reference(s), e.g. ${JSON.stringify(broken[0])}`);
        db.pragma(`user_version = ${v}`);
      })();
      console.log(`Database upgraded to version ${v} (${migrations[v - 1].name})`);
    }
  } finally {
    if (fkWasOn) db.pragma("foreign_keys = ON");
  }
}

// Safety net: compares every stored balance with the one its history adds up to
// (opening balance + money in - money out) and warns about any difference. Run on startup.
// It should never find anything; if it does, something changed the database behind the
// triggers' back (e.g. an UPDATE on accounts.balance by hand).
function checkBalances(db) {
  const wrong = db.prepare(`
    SELECT name, balance, expected FROM (
      SELECT a.name, a.balance, a.opening_balance
        + COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = a.id), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = a.id), 0) AS expected
      FROM accounts a
    ) WHERE balance <> expected
  `).all();
  for (const w of wrong) {
    console.warn(`WARNING: ${w.name} has a stored balance of ${w.balance / 100} but its transactions add up to ${w.expected / 100}`);
  }
  return wrong;
}

module.exports = { migrate, checkBalances, LATEST };
