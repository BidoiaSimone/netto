/* TURNING RECURRING TRANSACTIONS INTO REAL ONES
 * Every date of a rule that has arrived (today included) becomes a normal transaction, dated that day.
 * It runs when the server starts, right after a rule is added or changed, and again as soon as the
 * date changes (checked every minute), so a day the Mac was off is caught up the next time it's on.
 *
 * A rule is skipped while it is paused, after its end date, or while one of its accounts is closed
 * or gone (getPostingBlocker says why, so the Recurring page can show it).
 *
 * A rule billed in another currency (migration 14) passes its foreign amount on to each transaction. Their market
 * rate can't be looked up here (this runs inside a database transaction, which can't wait for the internet), so
 * fillMissingMarketRatesInBackground adds it right after.
 */

const db = require("../../db/databaseConnection.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { getNextOccurrenceDate } = require("./recurrenceSchedule.js");
const { fillMissingMarketRatesInBackground } = require("./exchangeRates.js");

const DATE_CHECK_INTERVAL_MILLISECONDS = 60 * 1000;
const MAXIMUM_OCCURRENCES_PER_RULE_PER_RUN = 1000; // a safety stop, far above any real catch-up

const insertRecurringOccurrence = db.prepare(`
  INSERT INTO transactions (from_account_id, to_account_id, type, amount, category_id, description, date, recurring_transaction_id,
                            original_currency, original_amount_minor)
  VALUES (@from_account_id, @to_account_id, @type, @amount, @category_id, @description, @date, @recurring_transaction_id,
          @original_currency, @original_amount_minor)
`);
const selectAccountNameAndClosedDate = db.prepare(`SELECT name, closed_at FROM accounts WHERE id = ?`);

// Why a rule can't add its transactions right now, or null when nothing stops it
function getPostingBlocker(rule) {
  if (rule.paused) return "paused";
  for (const accountId of [rule.from_account_id, rule.to_account_id]) {
    if (accountId === null) continue;
    const account = selectAccountNameAndClosedDate.get(accountId);
    if (!account) return "its account no longer exists";
    if (account.closed_at) return `${account.name} is closed`;
  }
  return null;
}

// Adds every due transaction of one rule. Returns how many were added. Call inside db.transaction().
function postDueOccurrencesOfRule(rule, today) {
  if (getPostingBlocker(rule)) return 0;
  let postedNow = 0;
  let nextDate = getNextOccurrenceDate(rule);
  while (nextDate !== null && nextDate <= today && postedNow < MAXIMUM_OCCURRENCES_PER_RULE_PER_RUN) {
    insertRecurringOccurrence.run({
      from_account_id: rule.from_account_id, to_account_id: rule.to_account_id, type: rule.type, amount: rule.amount,
      category_id: rule.category_id, description: rule.description, date: nextDate, recurring_transaction_id: rule.id,
      original_currency: rule.original_currency ?? null, original_amount_minor: rule.original_amount_minor ?? null,
    });
    rule.posted_count++;
    postedNow++;
    nextDate = getNextOccurrenceDate(rule);
  }
  if (postedNow) db.prepare(`UPDATE recurring_transactions SET posted_count = ? WHERE id = ?`).run(rule.posted_count, rule.id);
  return postedNow;
}

// Every rule, all or nothing. Returns how many transactions were added.
const postAllDueRecurringTransactionsInOneDatabaseTransaction = db.transaction(() => {
  const today = getTodayAsLocalDate();
  let totalPosted = 0;
  for (const rule of db.prepare(`SELECT * FROM recurring_transactions`).all()) totalPosted += postDueOccurrencesOfRule(rule, today);
  if (totalPosted) console.log(`Recurring transactions: ${totalPosted} added`);
  return totalPosted;
});

// Can be called inside another db.transaction() (the routes do: the rule and its first transactions together).
// The market rates of foreign-currency ones are filled in afterwards, without waiting.
function postAllDueRecurringTransactions() {
  const totalPosted = postAllDueRecurringTransactionsInOneDatabaseTransaction();
  if (totalPosted) setImmediate(fillMissingMarketRatesInBackground); // after the caller's own database transaction ends
  return totalPosted;
}

// Never lets a failure stop the server: it is logged and tried again at the next check
function postAllDueRecurringTransactionsSafely() {
  try {
    return postAllDueRecurringTransactions();
  } catch (error) {
    console.error(`Recurring transactions could not be added: ${error.message}`);
    return 0;
  }
}

function startRecurringTransactionPoster() {
  let lastCheckedDay = getTodayAsLocalDate();
  postAllDueRecurringTransactionsSafely();
  fillMissingMarketRatesInBackground(); // any foreign-currency transaction saved while offline
  setInterval(() => {
    const today = getTodayAsLocalDate();
    if (today === lastCheckedDay) return;
    lastCheckedDay = today;
    postAllDueRecurringTransactionsSafely();
  }, DATE_CHECK_INTERVAL_MILLISECONDS).unref();
}

module.exports = { startRecurringTransactionPoster, postAllDueRecurringTransactions, postAllDueRecurringTransactionsSafely, getPostingBlocker };
