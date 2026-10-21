/* THE MONTH'S WRAP-UP (a card on Home from the 1st of each month, until you close it)
 *
 * Last month in a few lines: what came in and went out, what you saved, the categories that cost most (against the
 * month before), the biggest single purchase, how the budgets and goals went, and on how many days you added
 * something (the habit netto is there to build). Read from the transactions, the budgets
 * (services/budgetCalculator.js) and the goals (services/savingsGoals.js): no tables of its own.
 *
 * Shown once: closing it saves the month in the setting month_wrap_up_dismissed (as 202610 for October 2026), so it
 * doesn't come back, on this device or any other. The next one appears on the 1st of the next month.
 * Nothing is shown for a month with no records at all (before you started using netto).
 * The month you started counts only from your first record, and says so (is_partial).
 *
 * Income and expenses only: movements, reconciliations and investment trades are neither (like Insights).
 * Money in cents here; the route converts.
 */

const db = require("../../db/databaseConnection.js");
const { findFirstRecordedDate } = require("../../db/firstRecordedDate.js");
const { buildBudgetVsActual } = require("./budgetCalculator.js");
const { calculateGoalProgress } = require("./savingsGoals.js");
const { readSetting } = require("./appSettings.js");

const TOP_CATEGORY_COUNT = 3;

const padTwoDigits = (number) => String(number).padStart(2, "0");
const countDaysInMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const previousMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${padTwoDigits(month - 1)}`;
};
const countDaysBetween = (firstDay, lastDay) => Math.round((Date.parse(lastDay) - Date.parse(firstDay)) / 864e5) + 1;
const monthAsNumber = (yearMonth) => Number(yearMonth.replace("-", "")); // "2026-10" -> 202610

// The days of a month your records cover: from the 1st (or your first record) to its last day. Null if none.
function findRecordedDaysOfMonth(yearMonth, firstRecordedDay) {
  const lastDay = `${yearMonth}-${padTwoDigits(countDaysInMonth(yearMonth))}`;
  const firstDay = firstRecordedDay > `${yearMonth}-01` ? firstRecordedDay : `${yearMonth}-01`;
  return firstDay <= lastDay ? { from: firstDay, to: lastDay } : null;
}

const sumOfType = (type, from, to) =>
  db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = ? AND date BETWEEN ? AND ?`).get(type, from, to).total;

function sumExpensesByCategory(from, to) {
  return db.prepare(`
    SELECT t.category_id, COALESCE(c.name, 'Uncategorized') AS name, SUM(t.amount) AS total
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND t.date BETWEEN ? AND ? GROUP BY t.category_id ORDER BY total DESC
  `).all(from, to);
}

// yearMonth: "2026-10". Null when the month has no recorded days.
function buildMonthWrapUp(yearMonth, today) {
  const firstRecordedDay = findFirstRecordedDate(db);
  const period = findRecordedDaysOfMonth(yearMonth, firstRecordedDay);
  if (!period) return null;
  const { from, to } = period;

  const income = sumOfType("income", from, to);
  const expenses = sumOfType("expense", from, to);
  const before = findRecordedDaysOfMonth(previousMonth(yearMonth), firstRecordedDay);
  const expensesBefore = before ? sumOfType("expense", before.from, before.to) : null;

  const categoriesBefore = new Map(before ? sumExpensesByCategory(before.from, before.to).map((row) => [row.category_id, row.total]) : []);
  const topCategories = sumExpensesByCategory(from, to).slice(0, TOP_CATEGORY_COUNT).map((row) => ({
    name: row.name, amount: row.total, amount_before: before ? (categoriesBefore.get(row.category_id) ?? 0) : null,
  }));

  const biggestExpense = db.prepare(`
    SELECT t.date, t.amount, t.description, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND t.recurring_transaction_id IS NULL AND t.date BETWEEN ? AND ? ORDER BY t.amount DESC, t.date LIMIT 1
  `).get(from, to) ?? null;

  const budgetVsActual = buildBudgetVsActual(from, to); // euros
  const budgets = budgetVsActual.rows.length ? {
    within: budgetVsActual.rows.filter((row) => row.difference >= 0).length,
    over: budgetVsActual.rows.filter((row) => row.difference < 0).map((row) => ({ name: row.name, budget: Math.round(row.budget * 100), actual: Math.round(row.actual * 100) })),
  } : null;

  const goals = calculateGoalProgress(today < to ? today : to)
    .map((goal) => ({ name: goal.name, row: goal.months.find((row) => row.month === yearMonth) }))
    .filter((goal) => goal.row)
    .map((goal) => ({ name: goal.name, saved: goal.row.saved + goal.row.carried_in }));

  // the days you added something by hand: recurring ones, reconciliations and trades don't count
  const daysWithEntries = db.prepare(`
    SELECT COUNT(DISTINCT date) AS days FROM transactions
    WHERE date BETWEEN ? AND ? AND recurring_transaction_id IS NULL AND type IN ('expense', 'income', 'movement')
  `).get(from, to).days;

  return {
    month: yearMonth, from, to,
    is_partial: from !== `${yearMonth}-01`,
    income, expenses, saved: income - expenses,
    savings_rate: income > 0 ? (income - expenses) / income : null,
    expenses_before: expensesBefore,
    previous_is_partial: before ? before.from !== `${previousMonth(yearMonth)}-01` : null,
    top_categories: topCategories,
    biggest_expense: biggestExpense,
    budgets,
    goals,
    days_with_entries: daysWithEntries,
    days: countDaysBetween(from, to),
  };
}

// Every month a wrap-up can be looked at again (Settings): from your first record's month to last month, newest first
function listMonthsWithWrapUps(today) {
  const firstMonth = findFirstRecordedDate(db).slice(0, 7);
  const months = [];
  for (let month = previousMonth(today.slice(0, 7)); month >= firstMonth; month = previousMonth(month)) months.push(month);
  return months;
}

// The wrap-up Home should show today: last month's, unless it was closed already or has no records. Null otherwise.
function findWrapUpToShow(today) {
  const lastMonth = previousMonth(today.slice(0, 7));
  if (readSetting("month_wrap_up_dismissed") >= monthAsNumber(lastMonth)) return null;
  return buildMonthWrapUp(lastMonth, today);
}

module.exports = { buildMonthWrapUp, findWrapUpToShow, listMonthsWithWrapUps, monthAsNumber };
