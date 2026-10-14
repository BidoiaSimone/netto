/* MIGRATION 7. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 7: recurring transactions ----
// A recurring transaction is a rule ("Rent, 700 €, from BBVA, every month from 1 Nov"). It is not money
// itself: when one of its dates comes, a normal transaction is added (services/recurringTransactionPoster.js),
// which the balance triggers then apply like any other. That transaction remembers which rule added it
// (transactions.recurring_transaction_id); deleting the rule keeps the transactions it already added.
//
// The schedule is start_date + every `repeat_interval` `repeat_unit`s (week / month / year).
// posted_count is how many of its dates have been turned into transactions: the next date is always
// worked out from start_date and that count, never by adding a month to the previous date, so a rule
// starting on the 31st stays on the 31st (or the last day of shorter months) instead of drifting.
function createRecurringTransactionsTable(db) {
  db.exec(`
    CREATE TABLE recurring_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'movement')),
      amount INTEGER NOT NULL CHECK (amount > 0),  -- cents
      from_account_id INTEGER REFERENCES accounts(id),
      to_account_id INTEGER REFERENCES accounts(id),
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      description TEXT,
      repeat_unit TEXT NOT NULL CHECK (repeat_unit IN ('week', 'month', 'year')),
      repeat_interval INTEGER NOT NULL DEFAULT 1 CHECK (repeat_interval >= 1),  -- every 2 months = 2 + 'month'
      start_date TEXT NOT NULL,                     -- YYYY-MM-DD, the first date
      end_date TEXT,                                -- last date allowed; NULL = never ends
      posted_count INTEGER NOT NULL DEFAULT 0,      -- dates already turned into transactions
      paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
      created_at TEXT NOT NULL,
      CHECK (from_account_id IS NOT NULL OR to_account_id IS NOT NULL),
      CHECK (from_account_id IS NOT to_account_id)
    );

    ALTER TABLE transactions ADD COLUMN recurring_transaction_id INTEGER REFERENCES recurring_transactions(id) ON DELETE SET NULL;
  `);
}

module.exports = createRecurringTransactionsTable;
