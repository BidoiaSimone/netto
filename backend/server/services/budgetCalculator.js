/* MONTHLY BUDGETS: the limit in effect each month, and how spending compares with it (migration 11)
 *
 *   findLimitsInEffect(month)            every expense category's limit for one month (cents)
 *   buildMonthBudgetProgress(today)      Insights > This month: spent so far vs the limit, and where the month
 *                                        is heading for each budgeted category
 *   buildBudgetVsActual(from, to)        Statements: the budget of any period vs what was really spent
 *
 * Only expenses count against a budget (recurring ones included: they are normal transactions once added).
 * Spending in a category during a month it had no budget is "unbudgeted", even if it has a budget in other
 * months of the same period: comparing a whole year of Groceries with the one month that had a limit would
 * make the budget look blown when it wasn't.
 */

const db = require("../../db/databaseConnection.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { getOccurrenceDate, countOccurrencesUpTo } = require("./recurrenceSchedule.js");
const { getPostingBlocker } = require("./recurringTransactionPoster.js");

const NEAR_THE_LIMIT_SHARE = 0.8;               // from 80% of the limit the bar turns amber
const DAYS_BEFORE_THE_PACE_MEANS_SOMETHING = 5; // same as the projection on Insights (monthProjection.js)

// ---------- months ----------

const padTwoDigits = (number) => String(number).padStart(2, "0");
const countDaysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12
const lastDayOfMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return `${yearMonth}-${padTwoDigits(countDaysInMonth(year, month))}`;
};
const nextMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${padTwoDigits(month + 1)}`;
};

// The months a period touches, each with how much of it the period covers:
// 2026-01-20 … 2026-03-10 -> [{ month: "2026-01", daysCovered: 12, daysInMonth: 31 }, { "2026-02", 28, 28 }, { "2026-03", 10, 31 }]
function listMonthsOfPeriod(from, to) {
  const months = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = nextMonth(month)) {
    const firstDay = from > `${month}-01` ? from : `${month}-01`;
    const lastDay = to < lastDayOfMonth(month) ? to : lastDayOfMonth(month);
    const daysInMonth = Number(lastDayOfMonth(month).slice(8));
    months.push({ month, daysCovered: Number(lastDay.slice(8)) - Number(firstDay.slice(8)) + 1, daysInMonth });
  }
  return months;
}

// ---------- the limit in effect ----------

// Every expense category that has (or had) a budget, with its rows oldest first:
// Map category id -> { name, spendingPace, rows: [{ from_month, monthly_limit }] }
function loadBudgetHistory() {
  const historyByCategoryId = new Map();
  const rows = db.prepare(`
    SELECT b.category_id, c.name, c.spending_pace, b.from_month, b.monthly_limit
    FROM category_budgets b JOIN categories c ON c.id = b.category_id
    WHERE c.kind = 'expense'          -- a category moved to the income list keeps its rows, but they don't count
    ORDER BY c.name COLLATE NOCASE, b.from_month
  `).all();
  for (const row of rows) {
    if (!historyByCategoryId.has(row.category_id)) historyByCategoryId.set(row.category_id, { name: row.name, spendingPace: row.spending_pace, rows: [] });
    historyByCategoryId.get(row.category_id).rows.push(row);
  }
  return historyByCategoryId;
}

// The newest row on or before `month` decides; null = no budget that month
function findLimitInMonth(budgetRows, month) {
  let limitInEffect = null;
  for (const row of budgetRows) if (row.from_month <= month) limitInEffect = row.monthly_limit;
  return limitInEffect;
}

// Map category id -> limit (cents) for every expense category with a budget in `month`
function findLimitsInEffect(month, budgetHistory = loadBudgetHistory()) {
  const limitByCategoryId = new Map();
  for (const [categoryId, history] of budgetHistory) {
    const limit = findLimitInMonth(history.rows, month);
    if (limit !== null) limitByCategoryId.set(categoryId, limit);
  }
  return limitByCategoryId;
}

// ---------- Insights > This month ----------

// What each category's recurring rules will still add after `today` and before the month ends (cents).
// By date, not by posted_count: what's on or before today is already a transaction (or is skipped).
function sumRecurringExpensesStillDue(today, monthEnd) {
  const stillDueByCategoryId = new Map();
  for (const rule of db.prepare(`SELECT * FROM recurring_transactions WHERE type = 'expense'`).all()) {
    if (getPostingBlocker(rule)) continue; // paused, or its account is closed: it won't add anything
    for (let index = countOccurrencesUpTo(rule, today); ; index++) {
      const date = getOccurrenceDate(rule, index);
      if (date > monthEnd || (rule.end_date && date > rule.end_date)) break;
      stillDueByCategoryId.set(rule.category_id, (stillDueByCategoryId.get(rule.category_id) ?? 0) + rule.amount);
    }
  }
  return stillDueByCategoryId;
}

// For each budgeted category: spent so far, the limit, and the month-end projection, worked out like the
// "Projected spending" card: recurring (already added + still due) + the rest at this month's daily pace.
// An 'occasional' category (migration 16: rent, gifts...) gets no pace: its other spending stays as it is.
// today: YYYY-MM-DD (a parameter so the tests can pick the day). Money in euros.
function buildMonthBudgetProgress(today) {
  const month = today.slice(0, 7);
  const monthEnd = lastDayOfMonth(month);
  const dayOfMonth = Number(today.slice(8));
  const daysInMonth = Number(monthEnd.slice(8));

  const spendingRows = db.prepare(`
    SELECT category_id,
           SUM(CASE WHEN recurring_transaction_id IS NOT NULL THEN amount ELSE 0 END) AS recurring,
           SUM(CASE WHEN recurring_transaction_id IS NULL THEN amount ELSE 0 END) AS variable
    FROM transactions WHERE type = 'expense' AND date BETWEEN ? AND ?
    GROUP BY category_id
  `).all(`${month}-01`, today);
  const spendingByCategoryId = new Map(spendingRows.map((row) => [row.category_id, row]));
  const stillDueByCategoryId = sumRecurringExpensesStillDue(today, monthEnd);

  const categories = [];
  let unbudgetedSpent = 0;
  const history = loadBudgetHistory();
  const limits = findLimitsInEffect(month, history);
  for (const row of spendingRows) if (!limits.has(row.category_id)) unbudgetedSpent += row.recurring + row.variable;

  for (const [categoryId, limit] of limits) {
    const spending = spendingByCategoryId.get(categoryId) ?? { recurring: 0, variable: 0 };
    const spent = spending.recurring + spending.variable;
    const variableByTheEnd = history.get(categoryId).spendingPace === "occasional" ? spending.variable : (spending.variable / dayOfMonth) * daysInMonth;
    const projected = Math.round(spending.recurring + (stillDueByCategoryId.get(categoryId) ?? 0) + variableByTheEnd);
    const status = spent > limit ? "over" : spent >= NEAR_THE_LIMIT_SHARE * limit ? "near" : "ok";
    categories.push({
      category_id: categoryId,
      name: history.get(categoryId).name,
      limit: convertCentsToEuros(limit),
      spent: convertCentsToEuros(spent),
      left: convertCentsToEuros(limit - spent),              // negative = over
      share_used: spent / limit,                            // 0.85 = 85%
      status,                                               // ok | near (80%+) | over (100%+)
      projected: convertCentsToEuros(projected),
      projected_over_by: convertCentsToEuros(Math.max(0, projected - limit)), // 0 = on track to stay within it
    });
  }

  const totalLimit = [...limits.values()].reduce((sum, limit) => sum + limit, 0);
  const totalBudgetedSpent = categories.reduce((sum, category) => sum + Math.round(category.spent * 100), 0);
  return {
    month, day_of_month: dayOfMonth, days_in_month: daysInMonth,
    is_early_in_the_month: dayOfMonth < DAYS_BEFORE_THE_PACE_MEANS_SOMETHING,
    categories,
    total_limit: convertCentsToEuros(totalLimit),
    total_spent: convertCentsToEuros(totalBudgetedSpent),
    unbudgeted_spent: convertCentsToEuros(unbudgetedSpent), // expenses in categories without a budget this month, uncategorized included
  };
}

// ---------- Statements: budget vs actual ----------

// For a period from `from` to `to` (YYYY-MM-DD, already checked), each budgeted category's budget, prorated:
//   budget = Σ over the months of the period: that month's limit × days of it in the period ÷ days in the month
// so a whole month counts its full limit and 10 days of a 31-day month count 10/31 of it.
// actual = what was spent in that category during the months it had a budget. Money in euros.
function buildBudgetVsActual(from, to) {
  const months = listMonthsOfPeriod(from, to);
  const spentByCategoryAndMonth = new Map(); // "categoryId|YYYY-MM" -> cents (category id "null" = uncategorized)
  let totalSpent = 0;
  const spendingRows = db.prepare(`
    SELECT category_id, substr(date, 1, 7) AS month, SUM(amount) AS total
    FROM transactions WHERE type = 'expense' AND date BETWEEN ? AND ?
    GROUP BY category_id, month
  `).all(from, to);
  for (const row of spendingRows) {
    spentByCategoryAndMonth.set(`${row.category_id}|${row.month}`, row.total);
    totalSpent += row.total;
  }

  const rows = [];
  for (const [categoryId, history] of loadBudgetHistory()) {
    let exactBudget = 0, actual = 0, budgetedMonths = 0;
    for (const { month, daysCovered, daysInMonth } of months) {
      const limit = findLimitInMonth(history.rows, month);
      if (limit === null) continue;
      exactBudget += (limit * daysCovered) / daysInMonth;
      budgetedMonths += daysCovered / daysInMonth;
      actual += spentByCategoryAndMonth.get(`${categoryId}|${month}`) ?? 0;
    }
    if (budgetedMonths === 0) continue; // no budget at all in this period
    const budget = Math.round(exactBudget); // rounded once, at the end: the fractions of each month add up first
    rows.push({ categoryId, name: history.name, budget, actual, budgetedMonths });
  }

  const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0);
  const totalActual = rows.reduce((sum, row) => sum + row.actual, 0);
  return {
    months: Math.round(months.reduce((sum, month) => sum + month.daysCovered / month.daysInMonth, 0) * 100) / 100, // 1.45 = a month and a half
    rows: rows.map((row) => ({
      category_id: row.categoryId,
      name: row.name,
      budget: convertCentsToEuros(row.budget),
      actual: convertCentsToEuros(row.actual),
      difference: convertCentsToEuros(row.budget - row.actual), // left (positive) or over (negative)
      share_used: row.budget > 0 ? row.actual / row.budget : null,
      budgeted_months: Math.round(row.budgetedMonths * 100) / 100,
    })),
    total_budget: convertCentsToEuros(totalBudget),
    total_actual: convertCentsToEuros(totalActual),
    total_difference: convertCentsToEuros(totalBudget - totalActual),
    unbudgeted_actual: convertCentsToEuros(totalSpent - totalActual), // every other expense of the period
  };
}

module.exports = { listMonthsOfPeriod, findLimitsInEffect, buildMonthBudgetProgress, buildBudgetVsActual, sumRecurringExpensesStillDue };
