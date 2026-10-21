/* CHECKS A RECURRING TRANSACTION SENT BY THE FRONTEND (add and edit follow the same rules)
 * The money part (type, amount, accounts, category, description) follows exactly the rules of a normal
 * transaction (transactionValidation.js); the schedule part is checked here.
 */

const { validateTransaction } = require("./transactionValidation.js");
const { REPEAT_UNITS } = require("../services/recurrenceSchedule.js");

const MAXIMUM_REPEAT_INTERVAL = 120; // every 120 weeks / months / years is already plenty
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealCalendarDate(dateText) {
  if (!DATE_PATTERN.test(dateText)) return false;
  const parsedDate = new Date(dateText + "T00:00:00Z");
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().startsWith(dateText); // rejects 2026-02-30
}

// Returns { error } or { rule } (amount in cents, ids as numbers).
// accountIdsAlreadyUsed: the rule's accounts before an edit (allowed even if since closed)
function validateRecurringTransaction(requestBody = {}, accountIdsAlreadyUsed = []) {
  // the date isn't a transaction date here: leave it out, the schedule has its own dates
  const { error, transaction } = validateTransaction({ ...requestBody, date: undefined }, accountIdsAlreadyUsed);
  if (error) return { error };

  if (!REPEAT_UNITS.includes(requestBody.repeat_unit)) return { error: `repeat_unit must be one of: ${REPEAT_UNITS.join(", ")}` };
  const repeatInterval = Number(requestBody.repeat_interval ?? 1);
  if (!Number.isInteger(repeatInterval) || repeatInterval < 1 || repeatInterval > MAXIMUM_REPEAT_INTERVAL) {
    return { error: `repeat every must be a whole number from 1 to ${MAXIMUM_REPEAT_INTERVAL}` };
  }
  if (!isRealCalendarDate(requestBody.start_date)) return { error: "start date must be a valid YYYY-MM-DD date" };
  const endDate = requestBody.end_date || null;
  if (endDate !== null && !isRealCalendarDate(endDate)) return { error: "end date must be a valid YYYY-MM-DD date" };
  if (endDate !== null && endDate < requestBody.start_date) return { error: "the end date can't be before the start date" };

  return {
    rule: {
      type: transaction.type,
      amount: transaction.amount,
      fromAccountId: transaction.fromAccountId,
      toAccountId: transaction.toAccountId,
      categoryId: transaction.categoryId,
      description: transaction.description,
      originalCurrency: transaction.originalCurrency,     // a subscription billed in dollars (migration 14)
      originalAmountMinor: transaction.originalAmountMinor,
      repeatUnit: requestBody.repeat_unit,
      repeatInterval,
      startDate: requestBody.start_date,
      endDate,
      paused: requestBody.paused ? 1 : 0,
    },
  };
}

module.exports = { validateRecurringTransaction };
