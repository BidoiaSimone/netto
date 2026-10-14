/* MIGRATION 4. Already applied to existing databases: never edit it, add a new migration instead.
 * (Function name before the refactor: investmentTrades) */

const { findFirstRecordedDate } = require("../firstRecordedDate.js");

// ---- 4: investments as a history of trades, in cents, connected to the accounts ----
// Until now a holding was just "shares + average price", typed in by hand. From here on every
// buy and sell is a row of investment_trades, with its date, and a holding (investments) is what
// its trades add up to: shares, and amount_invested = what those shares cost (cents, average cost).
// The routes recalculate a holding from its trades after every change (rebuildHolding in
// services/holdingsCalculator.js), so a trade can be edited or deleted and the holding always follows.
//
// A trade can pay from / pay into an account: that cash movement is a normal transaction of the
// new type 'investment', so the account balance follows through the usual triggers. It is not
// income or spending (Insights ignores it), it is money changing form.
//
// Existing holdings become one 'buy' trade each, marked as an opening position and dated at the
// start of your records (the first account opening or transaction): the real purchase dates aren't
// known, and dating them today would make any back-dated sell look like selling shares not yet bought.
function recordInvestmentsAsTrades(db) {
  const start = findFirstRecordedDate(db);
  db.exec(`
    -- transactions: same table, the type list gains 'investment' (a CHECK can't be altered, so rebuild)
    CREATE TABLE transactions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_account_id INTEGER REFERENCES accounts(id),
      to_account_id INTEGER REFERENCES accounts(id),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'movement', 'adjustment', 'investment')),
      amount INTEGER NOT NULL CHECK (amount > 0),  -- cents, always positive: the direction is from -> to
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      description TEXT,
      date TEXT NOT NULL,
      CHECK (from_account_id IS NOT NULL OR to_account_id IS NOT NULL),
      CHECK (from_account_id IS NOT to_account_id)
    );
    INSERT INTO transactions_new SELECT id, from_account_id, to_account_id, type, amount, category_id, description, date FROM transactions;
    -- dropping the table also drops its triggers and indexes; they are created again below, unchanged
    DROP TABLE transactions;
    ALTER TABLE transactions_new RENAME TO transactions;
    CREATE INDEX transactions_from ON transactions(from_account_id);
    CREATE INDEX transactions_to ON transactions(to_account_id);
    CREATE INDEX transactions_date ON transactions(date);
    CREATE TRIGGER transactions_after_insert AFTER INSERT ON transactions BEGIN
      UPDATE accounts SET balance = balance - NEW.amount WHERE id = NEW.from_account_id;
      UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.to_account_id;
    END;
    CREATE TRIGGER transactions_after_delete AFTER DELETE ON transactions BEGIN
      UPDATE accounts SET balance = balance + OLD.amount WHERE id = OLD.from_account_id;
      UPDATE accounts SET balance = balance - OLD.amount WHERE id = OLD.to_account_id;
    END;
    CREATE TRIGGER transactions_after_update AFTER UPDATE OF amount, from_account_id, to_account_id ON transactions BEGIN
      UPDATE accounts SET balance = balance + OLD.amount WHERE id = OLD.from_account_id;
      UPDATE accounts SET balance = balance - OLD.amount WHERE id = OLD.to_account_id;
      UPDATE accounts SET balance = balance - NEW.amount WHERE id = NEW.from_account_id;
      UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.to_account_id;
    END;

    -- every buy and sell
    CREATE TABLE investment_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      date TEXT NOT NULL,
      shares REAL NOT NULL CHECK (shares > 0),     -- fractional shares are fine
      amount INTEGER NOT NULL CHECK (amount > 0),  -- cents: total paid (buy) or received (sell), fees included
      fees INTEGER NOT NULL DEFAULT 0 CHECK (fees >= 0),  -- cents, already inside amount; kept to show the price
      account_id INTEGER REFERENCES accounts(id),  -- where the money came from / went to; NULL = not tracked
      transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,  -- that cash movement
      note TEXT
    );
    CREATE INDEX investment_trades_ticker ON investment_trades(ticker, date);

    -- holdings: what the trades add up to (rebuilt by the routes, never typed in)
    CREATE TABLE investments_new (
      ticker TEXT PRIMARY KEY,
      shares REAL NOT NULL DEFAULT 0,
      amount_invested INTEGER NOT NULL DEFAULT 0,  -- cents: cost of the shares still held
      realized_gain INTEGER NOT NULL DEFAULT 0     -- cents: gain/loss already cashed in by selling
    );
  `);

  const old = db.prepare(`SELECT ticker, amount_invested, shares FROM investments`).all();
  const addTrade = db.prepare(`INSERT INTO investment_trades (ticker, side, date, shares, amount, note)
    VALUES (?, 'buy', ?, ?, ?, 'Opening position (bought before trades were recorded)')`);
  const addHolding = db.prepare(`INSERT INTO investments_new (ticker, shares, amount_invested) VALUES (?, ?, ?)`);
  for (const o of old) {
    const cents = Math.round(Number((o.amount_invested * 100).toPrecision(15)));
    if (!(o.shares > 0) || !(cents > 0)) continue; // nothing held: nothing to carry over
    addTrade.run(o.ticker, start, o.shares, cents);
    addHolding.run(o.ticker, o.shares, cents);
  }
  db.exec(`DROP TABLE investments; ALTER TABLE investments_new RENAME TO investments;`);
}

module.exports = recordInvestmentsAsTrades;
