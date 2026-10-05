/* TABLE DEFINITIONS - used by database.js on startup and by clear-db.js after a reset */

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_account TEXT,
      to_account TEXT,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'movement')),
      amount REAL NOT NULL CHECK (amount > 0),
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
      open_date TEXT NOT NULL
    );
  `);
}

module.exports = { createTables };
