/* BALANCE SAFETY NET
 * Compares every stored balance with the one its history adds up to
 * (opening balance + money in - money out) and warns about any difference. Run on startup.
 * It should never find anything; if it does, something changed the database behind the
 * triggers' back (e.g. an UPDATE on accounts.balance by hand).
 */

function findAccountsWithWrongBalance(db) {
  const accountsWithWrongBalance = db.prepare(`
    SELECT id, name, balance, expected FROM (
      SELECT a.id, a.name, a.balance, a.opening_balance
        + COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = a.id), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = a.id), 0) AS expected
      FROM accounts a
    ) WHERE balance <> expected
  `).all();
  for (const account of accountsWithWrongBalance) {
    // only the id: names and amounts would stay in the server log. The returned rows still carry everything
    console.warn(`WARNING: account #${account.id} has a stored balance that differs from what its transactions add up to`);
  }
  return accountsWithWrongBalance;
}

module.exports = { findAccountsWithWrongBalance };
