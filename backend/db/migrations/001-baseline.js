/* MIGRATION 1. Already applied to existing databases: never edit it, add a new migration instead.
 * (Function name before the refactor: baseline) */

// ---- 1: the schema as it was before migrations existed ----
// Databases from that time are all at user_version 0, whatever shape they are in, so this one
// is written to work on all of them: IF NOT EXISTS for the tables, and the old one-time upgrade
// from a free-text `category` column to category_id.
function createBaselineTables(db) {
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
}

module.exports = createBaselineTables;
