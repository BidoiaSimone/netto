/* RECURRING TRANSACTIONS (Recurring page): list, add, edit (pause / resume), delete.
 * A rule never moves money itself: its due dates become normal transactions
 * (services/recurringTransactionPoster.js), which is also run right after every change here.
 * Changing or deleting a rule never touches the transactions it already added: they are history,
 * edited one by one on the Transactions page like any other.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { validateRecurringTransaction } = require("../validation/recurringTransactionValidation.js");
const { getNextOccurrenceDate, countOccurrencesUpTo } = require("../services/recurrenceSchedule.js");
const { postAllDueRecurringTransactions, getPostingBlocker } = require("../services/recurringTransactionPoster.js");
const { describeForeignAmount } = require("../services/foreignCurrencyAmounts.js");

const router = express.Router();

const selectRuleById = db.prepare(`SELECT * FROM recurring_transactions WHERE id = ?`);
const selectLastPostedDate = db.prepare(`SELECT MAX(date) AS lastDate FROM transactions WHERE recurring_transaction_id = ?`);

// DB row (cents) -> API (euros), with what the page shows next to it.
// A rule billed in another currency has original_currency and original_amount (e.g. 9.99 USD), like a transaction.
function convertRuleRowForApi({ original_amount_minor, ...ruleRow }) {
  const blocker = getPostingBlocker(ruleRow);
  const { original_currency, original_amount } = describeForeignAmount({ ...ruleRow, original_amount_minor });
  return {
    ...ruleRow,
    original_currency,
    original_amount,
    amount: convertCentsToEuros(ruleRow.amount),
    paused: ruleRow.paused === 1,
    next_date: getNextOccurrenceDate(ruleRow),                   // null = ended
    last_posted_date: selectLastPostedDate.get(ruleRow.id).lastDate, // null = nothing added yet
    blocked_reason: blocker === "paused" ? null : blocker,       // e.g. "Cash is closed"
  };
}

// The day before `dateText` (local YYYY-MM-DD arithmetic is safe in UTC)
const getPreviousDay = (dateText) => new Date(Date.parse(dateText + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);

// How many dates count as already done after an edit. An edit never adds past dates (only creating a rule
// does): when the schedule changes, or the rule is resumed after a pause, every date of the new schedule up
// to yesterday counts as done, and so does any date up to the last transaction this rule already added.
// Moving the rent from the 5th to the 10th after this month's rent was added therefore waits for next month,
// and the dates missed while paused are skipped. Today's date still gets added.
function calculatePostedCountAfterEdit(existingRule, editedRule) {
  const newSchedule = { start_date: editedRule.startDate, repeat_unit: editedRule.repeatUnit, repeat_interval: editedRule.repeatInterval };
  const scheduleChanged = newSchedule.start_date !== existingRule.start_date
    || newSchedule.repeat_unit !== existingRule.repeat_unit
    || newSchedule.repeat_interval !== existingRule.repeat_interval;
  const isResuming = existingRule.paused === 1 && editedRule.paused === 0;
  if (!scheduleChanged && !isResuming) return existingRule.posted_count;

  const yesterday = getPreviousDay(getTodayAsLocalDate());
  const lastPostedDate = selectLastPostedDate.get(existingRule.id).lastDate;
  const doneUpTo = lastPostedDate && lastPostedDate > yesterday ? lastPostedDate : yesterday;
  return countOccurrencesUpTo(newSchedule, doneUpTo);
}

router.get("/recurring-transactions", function listRecurringTransactions(request, response) {
  const ruleRows = db.prepare(`
    SELECT r.*, fa.name AS from_account, ta.name AS to_account, c.name AS category
    FROM recurring_transactions r
    LEFT JOIN accounts fa ON fa.id = r.from_account_id
    LEFT JOIN accounts ta ON ta.id = r.to_account_id
    LEFT JOIN categories c ON c.id = r.category_id
    ORDER BY r.id
  `).all();
  response.json(ruleRows.map(convertRuleRowForApi));
});

// Dates already past (or today) are added at once; `added` says how many transactions that made
router.post("/recurring-transactions", function addRecurringTransaction(request, response) {
  const { error, rule } = validateRecurringTransaction(request.body);
  if (error) return response.status(400).json({ error });

  try {
    const result = db.transaction(() => {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO recurring_transactions (type, amount, from_account_id, to_account_id, category_id, description,
                                            repeat_unit, repeat_interval, start_date, end_date, paused, created_at,
                                            original_currency, original_amount_minor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(rule.type, rule.amount, rule.fromAccountId, rule.toAccountId, rule.categoryId, rule.description,
             rule.repeatUnit, rule.repeatInterval, rule.startDate, rule.endDate, rule.paused, getTodayAsLocalDate(),
             rule.originalCurrency, rule.originalAmountMinor);
      return { id: lastInsertRowid, added: postAllDueRecurringTransactions() };
    })();
    response.status(201).json({ message: "Recurring transaction added", ...result });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

// Edit (the body is the whole rule, like when adding one). Only future dates follow the change.
router.put("/recurring-transactions/:id", function editRecurringTransaction(request, response) {
  const ruleId = Number(request.params.id);
  const existingRule = selectRuleById.get(ruleId);
  if (!existingRule) return response.status(404).json({ error: "Recurring transaction not found" });

  const { error, rule } = validateRecurringTransaction(request.body, [existingRule.from_account_id, existingRule.to_account_id]);
  if (error) return response.status(400).json({ error });

  try {
    const added = db.transaction(() => {
      db.prepare(`
        UPDATE recurring_transactions
        SET type = ?, amount = ?, from_account_id = ?, to_account_id = ?, category_id = ?, description = ?,
            repeat_unit = ?, repeat_interval = ?, start_date = ?, end_date = ?, paused = ?, posted_count = ?,
            original_currency = ?, original_amount_minor = ?
        WHERE id = ?
      `).run(rule.type, rule.amount, rule.fromAccountId, rule.toAccountId, rule.categoryId, rule.description,
             rule.repeatUnit, rule.repeatInterval, rule.startDate, rule.endDate, rule.paused,
             calculatePostedCountAfterEdit(existingRule, rule), rule.originalCurrency, rule.originalAmountMinor, ruleId);
      return postAllDueRecurringTransactions();
    })();
    response.json({ message: "Recurring transaction updated", id: ruleId, added });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

// The transactions it already added stay (their link to the rule is cleared: ON DELETE SET NULL)
router.delete("/recurring-transactions/:id", function deleteRecurringTransaction(request, response) {
  const { changes } = db.prepare(`DELETE FROM recurring_transactions WHERE id = ?`).run(Number(request.params.id));
  if (!changes) return response.status(404).json({ error: "Recurring transaction not found" });
  response.json({ message: "Recurring transaction deleted" });
});

module.exports = router;
