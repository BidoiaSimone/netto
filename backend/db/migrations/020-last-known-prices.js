/* MIGRATION 20. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 20: the last price each investment had, for when Yahoo doesn't answer ----
// On a Saturday, or when Yahoo is slow or refuses too many questions at once, a live price can be missing: the
// investment then counted as 0 on Home while the Investments page (asking a moment later) had it. The last price
// that did arrive is kept here and used instead, marked with when it was fetched (services/livePrices.js).
function createLastKnownPricesTable(db) {
  db.exec(`
    CREATE TABLE last_known_prices (
      ticker TEXT PRIMARY KEY,
      price_in_euros REAL NOT NULL,   -- one share, already converted to euros
      fetched_at TEXT NOT NULL        -- ISO date and time
    );
  `);
}

module.exports = createLastKnownPricesTable;
