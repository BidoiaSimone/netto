/* MIGRATION 3. Already applied to existing databases: never edit it, add a new migration instead.
 * (Function name before the refactor: storedBalanceWithTriggers) */

// ---- 3: the balance is stored in accounts again, kept up to date by triggers ----
// So the database itself always shows what each account really holds (in a DB viewer, a copy
// of the file...), without calculating anything. The triggers below are rules SQLite runs by
// itself whenever a transaction is added, changed or deleted, wherever the change comes from
// (a route, an import, a script), so the stored balance can't drift from the history.
// opening_balance stays: it is the starting point findAccountsWithWrongBalance() (db/balanceIntegrityCheck.js) uses to verify everything.
function storeBalanceKeptUpByTriggers(db) {
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
}

module.exports = storeBalanceKeptUpByTriggers;
