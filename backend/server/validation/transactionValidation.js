/* CHECKS A TRANSACTION SENT BY THE FRONTEND and turns it into database values (amount in cents).
 * Used both to add a transaction and to edit one, so the two follow exactly the same rules.
 */

const db = require("../../db/databaseConnection.js");
const { convertEurosToCents } = require("../utils/moneyConversion.js");
const { getTodayAsLocalDate, parseDateOrDefaultToToday } = require("../utils/localDates.js");
const { parseOptionalId } = require("../utils/httpErrors.js");

// Which accounts each type needs: income only has a destination, expense only a source, movement both
const REQUIRED_ACCOUNTS_BY_TYPE = {
  income: { needsSourceAccount: false, needsDestinationAccount: true },
  expense: { needsSourceAccount: true, needsDestinationAccount: false },
  movement: { needsSourceAccount: true, needsDestinationAccount: true },
};

const selectAccountNameAndClosedDate = db.prepare(`SELECT name, closed_at FROM accounts WHERE id = ?`);

// "expense needs a source account", "movement needs a source and a destination account"
function describeMissingAccounts(type, { needsSourceAccount, needsDestinationAccount }) {
  const missing = [needsSourceAccount && "a source", needsDestinationAccount && "a destination"].filter(Boolean);
  return `${type} needs ${missing.join(" and ")} account`;
}

// Returns { error } or { transaction }.
// accountIdsAlreadyUsed: the account ids the transaction had before an edit (a closed account can stay
// on old transactions, it just can't be picked for new ones)
function validateTransaction(requestBody, accountIdsAlreadyUsed = []) {
  const requiredAccounts = REQUIRED_ACCOUNTS_BY_TYPE[requestBody.type];
  const amount = convertEurosToCents(requestBody.amount);

  if (!requiredAccounts) return { error: "type must be income, expense or movement" };
  if (!(amount > 0)) return { error: "amount must be at least 0.01" };

  const fromAccountId = requiredAccounts.needsSourceAccount ? parseOptionalId(requestBody.from_account_id) : null;
  const toAccountId = requiredAccounts.needsDestinationAccount ? parseOptionalId(requestBody.to_account_id) : null;
  const sourceIsMissing = requiredAccounts.needsSourceAccount && fromAccountId === null;
  const destinationIsMissing = requiredAccounts.needsDestinationAccount && toAccountId === null;
  if (sourceIsMissing || destinationIsMissing) return { error: describeMissingAccounts(requestBody.type, requiredAccounts) };
  if (fromAccountId !== null && fromAccountId === toAccountId) return { error: "source and destination must be different accounts" };

  for (const accountId of [fromAccountId, toAccountId]) {
    if (accountId === null) continue;
    const account = selectAccountNameAndClosedDate.get(accountId);
    if (!account) return { error: `Unknown account id: ${accountId}` };
    if (account.closed_at && !accountIdsAlreadyUsed.includes(accountId)) {
      return { error: `${account.name} is closed: reopen it on the Assets page to use it again` };
    }
  }

  const details = validateTransactionDetails(requestBody, requestBody.type);
  if (details.error) return details;
  return { transaction: { fromAccountId, toAccountId, type: requestBody.type, amount, ...details.details } };
}

// The part every transaction has, reconciliation adjustments included: date, category, description.
// An income needs an income category and an expense an expense one (migration 8); movements and
// reconciliations (no `type` given here) may use either kind.
// Returns { error } or { details: { date, categoryId, description } }.
function validateTransactionDetails(requestBody, type = null) {
  const date = parseDateOrDefaultToToday(requestBody.date);
  if (!date) return { error: "date must be a valid YYYY-MM-DD date" };
  if (date > getTodayAsLocalDate()) return { error: "date can't be in the future" };

  // Only categories from the list are accepted; empty = uncategorized
  const categoryId = parseOptionalId(requestBody.category_id);
  if (categoryId !== null) {
    const category = db.prepare(`SELECT name, kind FROM categories WHERE id = ?`).get(categoryId);
    if (!category) return { error: "Unknown category: pick one from the list or add it on the Categories page" };
    const requiredKind = type === "income" || type === "expense" ? type : null;
    if (requiredKind && category.kind !== requiredKind) {
      return { error: `${category.name} is an ${category.kind} category: an ${requiredKind} needs an ${requiredKind} category` };
    }
  }
  return { details: { date, categoryId, description: requestBody.description?.trim() || null } };
}

module.exports = { validateTransaction, validateTransactionDetails };
