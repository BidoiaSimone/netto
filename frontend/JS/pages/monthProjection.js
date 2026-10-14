// ---- Insights page, "This month": spending so far and where the month is heading ----
// Spending is split in two, because they behave differently:
//   recurring  rent, subscriptions... (added by a recurring transaction): already known, the ones still
//              due this month are taken from the Recurring page's schedules
//   variable   everything else: projected at the pace of the month so far (spent ÷ days passed × days in month)
// Income = what came in so far + the recurring incomes still due this month.
// Needs the transactions and the recurring transactions, which load separately: both loaders call
// renderMonthProjection(), and whichever finishes last draws the complete picture.

import { elementById } from "../core/domHelpers.js";
import { euroFormatter, getTodayAsLocalDate } from "../core/formatting.js";
import { appState } from "../core/appState.js";
import { getOccurrenceDate } from "../core/recurrenceDates.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const DAYS_BEFORE_THE_PACE_MEANS_SOMETHING = 5; // before this, a single purchase decides the whole projection

const countDaysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// The recurring incomes and expenses not added yet whose date falls in this month: { income, expense }
function sumRecurringStillDueThisMonth(monthEnd) {
  const stillDue = { income: 0, expense: 0 };
  for (const rule of appState.recurringTransactions) {
    if (rule.paused || rule.blocked_reason || !(rule.type in stillDue)) continue;
    // occurrences 0 … posted_count−1 are already transactions
    for (let index = rule.posted_count; index < rule.posted_count + 60; index++) {
      const date = getOccurrenceDate(rule, index);
      if (date > monthEnd || (rule.end_date && date > rule.end_date)) break;
      stillDue[rule.type] += rule.amount;
    }
  }
  return stillDue;
}

function calculateMonthProjection() {
  const today = getTodayAsLocalDate();
  const [year, month, dayOfMonth] = today.split("-").map(Number);
  const daysInMonth = countDaysInMonth(year, month);
  const currentMonth = today.slice(0, 7);
  const monthEnd = `${currentMonth}-${String(daysInMonth).padStart(2, "0")}`;

  let incomeSoFar = 0, recurringSpentSoFar = 0, variableSpentSoFar = 0;
  for (const transaction of appState.transactions) {
    if (!transaction.date.startsWith(currentMonth)) continue;
    if (transaction.type === "income") incomeSoFar += transaction.amount;
    if (transaction.type !== "expense") continue;
    if (transaction.recurring_transaction_id) recurringSpentSoFar += transaction.amount;
    else variableSpentSoFar += transaction.amount;
  }

  const stillDue = sumRecurringStillDueThisMonth(monthEnd);
  const variableDailyPace = variableSpentSoFar / dayOfMonth;
  const projectedVariable = variableDailyPace * daysInMonth;
  const projectedRecurring = recurringSpentSoFar + stillDue.expense;
  const projectedIncome = incomeSoFar + stillDue.income;
  const projectedExpenses = projectedVariable + projectedRecurring;
  return {
    dayOfMonth, daysInMonth,
    spentSoFar: recurringSpentSoFar + variableSpentSoFar,
    variableDailyPace, projectedVariable, projectedRecurring, projectedExpenses,
    projectedIncome, projectedSavings: projectedIncome - projectedExpenses,
    isEarlyInTheMonth: dayOfMonth < DAYS_BEFORE_THE_PACE_MEANS_SOMETHING,
  };
}

export function renderMonthProjection() {
  const projection = calculateMonthProjection();
  elementById("month-spent").textContent = euroFormatter.format(projection.spentSoFar);
  elementById("month-spent-detail").textContent = `day ${projection.dayOfMonth} of ${projection.daysInMonth}`;

  elementById("month-projected-spending").textContent = euroFormatter.format(projection.projectedExpenses);
  elementById("month-projected-spending-detail").textContent =
    `${euroFormatter.format(projection.projectedRecurring)} recurring + ${euroFormatter.format(projection.projectedVariable)} other `
    + `(${euroFormatter.format(projection.variableDailyPace)} a day)${projection.isEarlyInTheMonth ? " · early in the month: rough" : ""}`;

  elementById("month-projected-savings").textContent = euroFormatter.format(projection.projectedSavings);
  elementById("month-projected-savings-detail").textContent = projection.projectedIncome > 0
    ? `${percentFormatter.format(projection.projectedSavings / projection.projectedIncome)} of ${euroFormatter.format(projection.projectedIncome)} expected income`
    : "no income expected this month";
}
