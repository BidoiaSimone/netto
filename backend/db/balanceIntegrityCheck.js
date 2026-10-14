/* BALANCE SAFETY NET
 * Compares every stored balance with the one its history adds up to
 * (opening balance + money in - money out) and warns about any difference. Run on startup.
 * It should never find anything; if it does, something changed the database behind the
 * triggers' back (e.g. an UPDATE on accounts.balance by hand).
 */

function findAccountsWithWrongBalance(db) {
  const accountsWithWrongBalance = db.prepare(`
    SELECT name, balance, expected FROM (
      SELECT a.name, a.balance, a.opening_balance
        + COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = a.id), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = a.id), 0) AS expected
      FROM accounts a
    ) WHERE balance <> expected
  `).all();
  for (const account of accountsWithWrongBalance) {
    console.warn(`WARNING: ${account.name} has a stored balance of ${account.balance / 100} but its transactions add up to ${account.expected / 100}`);
  }
  return accountsWithWrongBalance;
}

module.exports = { findAccountsWithWrongBalance };
