/* THE BALANCE RULE, CHECKED TWO WAYS
 * Every stored balance (accounts.balance, kept by the database triggers) must equal
 *     opening balance + money in − money out
 * over all of that account's transactions.
 *
 * backend/db/balanceIntegrityCheck.js already checks this with one SQL query. The tests also recompute
 * it here in plain JavaScript from the raw rows: if a bug were ever in that SQL query itself, the two
 * would disagree, instead of both being wrong in the same way.
 */

const { findAccountsWithWrongBalance } = require("../../backend/db/balanceIntegrityCheck.js");

// [{ name, stored, expected }] for every account whose balance breaks the rule (cents); [] when all is right
function recomputeBalancesAndListMismatches(db) {
  const expectedBalanceByAccountId = new Map();
  const accounts = db.prepare(`SELECT id, name, opening_balance, balance FROM accounts`).all();
  for (const account of accounts) expectedBalanceByAccountId.set(account.id, account.opening_balance);
  for (const transaction of db.prepare(`SELECT from_account_id, to_account_id, amount FROM transactions`).all()) {
    if (transaction.to_account_id !== null) expectedBalanceByAccountId.set(transaction.to_account_id, expectedBalanceByAccountId.get(transaction.to_account_id) + transaction.amount);
    if (transaction.from_account_id !== null) expectedBalanceByAccountId.set(transaction.from_account_id, expectedBalanceByAccountId.get(transaction.from_account_id) - transaction.amount);
  }
  return accounts
    .filter((account) => account.balance !== expectedBalanceByAccountId.get(account.id))
    .map((account) => ({ name: account.name, stored: account.balance, expected: expectedBalanceByAccountId.get(account.id) }));
}

// Both checks together: returns a list of problems, empty when every balance is right
function listAllBalanceProblems(db) {
  const originalWarn = console.warn;
  console.warn = () => {}; // the SQL check also prints a warning; the test failure message says it already
  try {
    return [...findAccountsWithWrongBalance(db).map((account) => ({ check: "SQL", ...account })),
            ...recomputeBalancesAndListMismatches(db).map((account) => ({ check: "JavaScript", ...account }))];
  } finally {
    console.warn = originalWarn;
  }
}

module.exports = { listAllBalanceProblems };
