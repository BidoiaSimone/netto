/* THE CASH SIDE OF AN INVESTMENT TRADE
 * A trade can move cash: paid from an account (buy) or received into one (sell). That movement is
 * a transaction of type 'investment', so the account balance follows by itself (database triggers),
 * and it doesn't count as income or spending. These functions keep that transaction in step with
 * its trade whenever the trade is added, edited or deleted.
 */

const db = require("../../db/databaseConnection.js");
const { formatShareCount } = require("./holdingsCalculator.js");

// A buy takes money from the account, a sell puts it in
function describeCashMovementOfTrade(trade) {
  return {
    fromAccountId: trade.side === "buy" ? trade.accountId : null,
    toAccountId: trade.side === "sell" ? trade.accountId : null,
    description: `${trade.side === "buy" ? "Buy" : "Sell"} ${formatShareCount(trade.shares)} ${trade.ticker}`,
  };
}

const insertInvestmentTransaction = db.prepare(`
  INSERT INTO transactions (from_account_id, to_account_id, type, amount, description, date)
  VALUES (?, ?, 'investment', ?, ?, ?)
`);

// Call inside a db.transaction. Creates, updates or removes the cash transaction of a trade so it
// matches `trade`. Returns the transaction id to store on the trade (null when no account is used).
function syncCashTransactionOfTrade(trade, existingTransactionId) {
  const cashMovement = describeCashMovementOfTrade(trade);
  if (trade.accountId === null) {
    if (existingTransactionId) db.prepare(`DELETE FROM transactions WHERE id = ?`).run(existingTransactionId); // trigger gives the money back
    return null;
  }
  const existingTransactionStillThere = existingTransactionId && db.prepare(`SELECT 1 FROM transactions WHERE id = ?`).get(existingTransactionId);
  if (existingTransactionStillThere) {
    // the update trigger undoes the old cash movement and applies the new one
    db.prepare(`UPDATE transactions SET from_account_id = ?, to_account_id = ?, amount = ?, description = ?, date = ? WHERE id = ?`)
      .run(cashMovement.fromAccountId, cashMovement.toAccountId, trade.amount, cashMovement.description, trade.date, existingTransactionId);
    return existingTransactionId;
  }
  return insertInvestmentTransaction.run(cashMovement.fromAccountId, cashMovement.toAccountId, trade.amount, cashMovement.description, trade.date).lastInsertRowid;
}

module.exports = { syncCashTransactionOfTrade };
