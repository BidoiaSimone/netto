// ---- Insights page, "This month": spending so far and where the month is heading ----
// Spending is split in three, because they behave differently:
//   recurring   rent, subscriptions... (added by a recurring transaction): already known, the ones still
//               due this month are taken from the Recurring page's schedules
//   one-off      expenses in a one-off category (Gifts, Products: Categories page; stored as
//                spending_pace 'occasional', migration 16): counted as they are, nothing guessed on top,
//                since one 300 € gift on the 3rd doesn't mean another one every three days
//   habitual     everything else (groceries, coffee...; spending_pace 'daily'): projected at the pace of
//                the month so far (spent ÷ days recorded × days in month). Days recorded start from the 1st,
//                or from your first record if that came later (the month you started using netto)
// Income = what came in so far + the recurring incomes still due this month.
// Needs the transactions and the recurring transactions, which load separately: both loaders call
// renderMonthProjection(), and whichever finishes last draws the complete picture.

import { elementById, createElement } from "../core/domHelpers.js";
import { euroFormatter, getTodayAsLocalDate } from "../core/formatting.js";
import { appState } from "../core/appState.js";
import { getOccurrenceDate } from "../core/recurrenceDates.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const DAYS_BEFORE_THE_PACE_MEANS_SOMETHING = 5; // before this, a single purchase decides the whole projection

const countDaysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// The earliest account opening or transaction date, like backend/db/firstRecordedDate.js (null with no data)
function findFirstRecordedDate() {
  const dates = [...appState.accounts.map((account) => account.open_date), ...appState.transactions.map((transaction) => transaction.date)].filter(Boolean);
  return dates.length ? dates.reduce((earliest, date) => (date < earliest ? date : earliest)) : null;
}

// The last day of the current month, as "YYYY-MM-DD"
function getCurrentMonthEnd() {
  const today = getTodayAsLocalDate();
  const [year, month] = today.split("-").map(Number);
  return `${today.slice(0, 7)}-${String(countDaysInMonth(year, month)).padStart(2, "0")}`;
}

// The recurring incomes and expenses not added yet whose date falls in this month: { income, expense }
export function sumRecurringStillDueThisMonth(monthEnd = getCurrentMonthEnd()) {
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

  const occasionalCategoryIds = new Set(appState.categories
    .filter((category) => category.spending_pace === "occasional")
    .map((category) => category.id));

  let incomeSoFar = 0, recurringSpentSoFar = 0, oneOffSpentSoFar = 0, everydaySpentSoFar = 0;
  for (const transaction of appState.transactions) {
    if (!transaction.date.startsWith(currentMonth)) continue;
    if (transaction.type === "income") incomeSoFar += transaction.amount;
    if (transaction.type !== "expense") continue;
    if (transaction.recurring_transaction_id) recurringSpentSoFar += transaction.amount;
    else if (occasionalCategoryIds.has(transaction.category_id)) oneOffSpentSoFar += transaction.amount;
    else everydaySpentSoFar += transaction.amount;
  }

  // spending recorded on 12 days says nothing about the 4 days before you started recording
  const firstRecordedDate = findFirstRecordedDate();
  const firstDayRecorded = firstRecordedDate?.startsWith(currentMonth) ? Number(firstRecordedDate.slice(8)) : 1;
  const daysRecorded = Math.max(1, dayOfMonth - firstDayRecorded + 1);

  const stillDue = sumRecurringStillDueThisMonth(monthEnd);
  const everydayDailyPace = everydaySpentSoFar / daysRecorded;
  const projectedEveryday = everydayDailyPace * daysInMonth;
  const projectedRecurring = recurringSpentSoFar + stillDue.expense;
  const projectedIncome = incomeSoFar + stillDue.income;
  const projectedExpenses = projectedRecurring + oneOffSpentSoFar + projectedEveryday;
  return {
    dayOfMonth, daysInMonth,
    spentSoFar: recurringSpentSoFar + oneOffSpentSoFar + everydaySpentSoFar,
    recurringSpentSoFar, everydaySpentSoFar,
    everydayDailyPace, projectedEveryday, oneOffSpentSoFar, projectedRecurring, projectedExpenses,
    projectedIncome, projectedSavings: projectedIncome - projectedExpenses,
    isEarlyInTheMonth: daysRecorded < DAYS_BEFORE_THE_PACE_MEANS_SOMETHING,
  };
}

// One line of a card's breakdown: coloured dot, name (+ an optional note), amount
function createBreakdownRow(part) {
  const row = createElement("div", `month-breakdown-row ${part.className}`);
  const label = createElement("span", "month-breakdown-label", part.label);
  if (part.note) label.append(createElement("small", "", part.note));
  row.append(createElement("i", "month-breakdown-dot"), label, createElement("span", "month-breakdown-amount", euroFormatter.format(part.amount)));
  return row;
}

// A thin bar split in the three parts, then one row per part. Both cards use the projected total as the full
// width, so "Spent so far" shows how much of the month's spending has already happened.
function renderBreakdown(containerId, parts, fullAmount) {
  const bar = createElement("div", "month-breakdown-bar");
  for (const part of parts) {
    const segment = createElement("span", part.className);
    segment.style.width = fullAmount > 0 ? `${(part.amount / fullAmount) * 100}%` : "0";
    bar.append(segment);
  }
  elementById(containerId).replaceChildren(bar, ...parts.map(createBreakdownRow));
}

export function renderMonthProjection() {
  const projection = calculateMonthProjection();
  const full = projection.projectedExpenses;

  elementById("month-spent").textContent = euroFormatter.format(projection.spentSoFar);
  renderBreakdown("month-spent-breakdown", [
    { className: "recurring", label: "Recurring", amount: projection.recurringSpentSoFar },
    { className: "habitual", label: "Habitual", amount: projection.everydaySpentSoFar },
    { className: "one-off", label: "One-off", amount: projection.oneOffSpentSoFar },
  ], full);
  elementById("month-spent-detail").textContent = `day ${projection.dayOfMonth} of ${projection.daysInMonth}`;

  elementById("month-projected-spending").textContent = euroFormatter.format(full);
  renderBreakdown("month-projected-spending-breakdown", [
    { className: "recurring", label: "Recurring", note: "incl. still due", amount: projection.projectedRecurring },
    { className: "habitual", label: "Habitual", note: `${euroFormatter.format(projection.everydayDailyPace)}/day`, amount: projection.projectedEveryday },
    { className: "one-off", label: "One-off", note: "as spent", amount: projection.oneOffSpentSoFar },
  ], full);
  elementById("month-projected-spending-detail").textContent = projection.isEarlyInTheMonth ? "early in the month: rough" : "";

  elementById("month-projected-savings").textContent = euroFormatter.format(projection.projectedSavings);
  elementById("month-projected-savings-detail").textContent = projection.projectedIncome > 0
    ? `${percentFormatter.format(projection.projectedSavings / projection.projectedIncome)} of ${euroFormatter.format(projection.projectedIncome)} expected income`
    : "no income expected this month";
}
