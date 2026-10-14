/* ACCOUNTS (Assets page): list, add, edit, delete, close / reopen, reconcile.
 * The database stores cents; the API speaks euros.
 * `balance` is stored in the accounts table and kept up to date by triggers in the database
 * (migration 3) every time a transaction is added, changed or deleted.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { convertEurosToCents, convertCentsToEuros, euroCurrencyFormatter } = require("../utils/moneyConversion.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { createHttpError, sendErrorResponse } = require("../utils/httpErrors.js");
const { validateAccount } = require("../validation/accountValidation.js");

const router = express.Router();

// DB row (cents) -> API (euros)
const convertAccountRowForApi = (accountRow) => ({
  ...accountRow,
  opening_balance: convertCentsToEuros(accountRow.opening_balance),
  balance: convertCentsToEuros(accountRow.balance),
});

// `uses`: how many transactions, investment trades and recurring transactions involve the account. 0 = it can be deleted.
router.get("/accounts", function listAccounts(request, response) {
  const accountRows = db.prepare(`
    SELECT a.*,
           (SELECT COUNT(*) FROM transactions WHERE from_account_id = a.id OR to_account_id = a.id)
         + (SELECT COUNT(*) FROM investment_trades WHERE account_id = a.id)
         + (SELECT COUNT(*) FROM recurring_transactions WHERE from_account_id = a.id OR to_account_id = a.id) AS uses
    FROM accounts a ORDER BY a.id
  `).all();
  response.json(accountRows.map(convertAccountRowForApi));
});

// opening_balance: what the account holds today, before any transaction is recorded on it
router.post("/accounts", function addAccount(request, response) {
  const { error, account } = validateAccount(request.body);
  if (error) return response.status(400).json({ error });

  try {
    // The starting balance is typed in by hand, so it counts as verified today.
    // No transactions yet, so the balance is the opening balance.
    const today = getTodayAsLocalDate();
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO accounts (name, kind, opening_balance, balance, open_date, last_reconciled) VALUES (?, ?, ?, ?, ?, ?)
    `).run(account.name, account.kind, account.openingBalance, account.openingBalance, today, today);
    response.status(201).json({ message: "Account added successfully", id: lastInsertRowid });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return response.status(409).json({ error: `${account.name} already exists` });
    response.status(500).json({ error: error.message });
  }
});

// Edit: name, kind and opening balance. Changing the opening balance moves the current balance by the
// same amount (the transactions stay what they were), so the history still adds up: in the SET below,
// `opening_balance` on the right is the OLD value, SQLite computes every expression before writing.
router.put("/accounts/:id", function editAccount(request, response) {
  const accountId = Number(request.params.id);
  const { error, account } = validateAccount(request.body);
  if (error) return response.status(400).json({ error });

  try {
    const { changes } = db.prepare(`
      UPDATE accounts SET name = ?, kind = ?, balance = balance + (? - opening_balance), opening_balance = ? WHERE id = ?
    `).run(account.name, account.kind, account.openingBalance, account.openingBalance, accountId);
    if (!changes) return response.status(404).json({ error: "Account not found" });
    response.json({ message: "Account updated" });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return response.status(409).json({ error: `${account.name} already exists` });
    response.status(500).json({ error: error.message });
  }
});

// Delete: only an account nothing refers to (no transactions, trades or recurring transactions). One with history is closed instead.
router.delete("/accounts/:id", function deleteAccount(request, response) {
  const accountId = Number(request.params.id);
  try {
    const { changes } = db.prepare(`DELETE FROM accounts WHERE id = ?`).run(accountId);
    if (!changes) return response.status(404).json({ error: "Account not found" });
    response.json({ message: "Account deleted" });
  } catch (error) {
    // the foreign keys refuse it while transactions or trades still point to the account
    if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return response.status(409).json({ error: "This account has transactions or recurring transactions, so it can't be deleted: close it instead (its history stays)." });
    }
    response.status(500).json({ error: error.message });
  }
});

// Close: hidden from the Assets list and the pickers, history kept. Only at zero, or its money would
// silently leave (or stay hidden inside) the net worth.
router.post("/accounts/:id/close", function closeAccount(request, response) {
  const account = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(Number(request.params.id));
  if (!account) return response.status(404).json({ error: "Account not found" });
  if (account.balance !== 0) {
    const heldAmount = euroCurrencyFormatter.format(convertCentsToEuros(account.balance));
    return response.status(400).json({ error: `${account.name} still holds ${heldAmount}: move that money out, or reconcile it to 0, before closing it.` });
  }
  db.prepare(`UPDATE accounts SET closed_at = ? WHERE id = ?`).run(getTodayAsLocalDate(), account.id);
  response.json({ message: "Account closed" });
});

router.post("/accounts/:id/reopen", function reopenAccount(request, response) {
  const { changes } = db.prepare(`UPDATE accounts SET closed_at = NULL WHERE id = ?`).run(Number(request.params.id));
  if (!changes) return response.status(404).json({ error: "Account not found" });
  response.json({ message: "Account reopened" });
});

// Reconcile: you tell it what is really in the account. The difference from the recorded balance
// is saved as an 'adjustment' transaction; the insert trigger then moves the balance to the
// counted amount, so the history still adds up.
router.post("/accounts/:id/reconcile", function reconcileAccount(request, response) {
  const accountId = Number(request.params.id);
  const countedAmount = convertEurosToCents(request.body?.counted);
  if (!Number.isFinite(countedAmount)) return response.status(400).json({ error: "counted must be a number" });

  try {
    const result = db.transaction(() => {
      const account = db.prepare(`SELECT balance, closed_at, name FROM accounts WHERE id = ?`).get(accountId);
      if (!account) return null;
      if (account.closed_at) throw createHttpError(400, `${account.name} is closed: reopen it to reconcile it`);

      const today = getTodayAsLocalDate();
      const difference = countedAmount - account.balance; // integers: exact, no rounding needed
      if (difference !== 0) {
        db.prepare(`
          INSERT INTO transactions (from_account_id, to_account_id, type, amount, description, date)
          VALUES (?, ?, 'adjustment', ?, 'Reconciliation', ?)
        `).run(difference < 0 ? accountId : null, difference > 0 ? accountId : null, Math.abs(difference), today);
      }
      db.prepare(`UPDATE accounts SET last_reconciled = ? WHERE id = ?`).run(today, accountId);
      return { difference: convertCentsToEuros(difference) };
    })();

    if (!result) return response.status(404).json({ error: "Account not found" });
    response.json(result);
  } catch (error) {
    sendErrorResponse(response, error);
  }
});

module.exports = router;
