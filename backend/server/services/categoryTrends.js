/* CATEGORY TRENDS (Insights): is each expense category running above what's normal for you?
 *
 * For every expense category:
 *   this month    spent so far, and where the month is heading (the same projection as Insights > This month,
 *                 per category: the recurring expenses still due this month + the rest at this month's daily pace;
 *                 an 'occasional' category, like Rent or Gifts, gets no pace: what's spent so far stays as it is)
 *   last month    the last complete month
 *   usual         the average of the 6 complete months before this one. Fewer when netto doesn't have 6 yet: a month
 *                 counts only if your records cover all of it (the month your records start in counts only if they
 *                 start on its 1st), so a half-recorded first month doesn't drag the average down. `months_in_average`
 *                 says how many were used.
 *   12 months     the totals of the last 12 months, this one included (so far), for the small chart
 *
 * Trips. A holiday makes its months look expensive, and averaging it in would make every normal month after it look
 * cheap. With the setting trend_exclude_trips on (the default), transactions tagged with a TRIP are left out of the
 * usual average. A trip is a tag with dates (Categories page > Tags: "Japan 2027, from 3 to 17 April"); a tag without
 * dates ("Work") is just a label and changes nothing. This month and last month always show everything you spent.
 *
 * Running hot: this month's projection is above the usual average by at least the share AND the amount set in the
 * settings (25% and 20 € by default). Both, so a 4 € category going to 6 € (+50%) doesn't make noise. A category
 * with no usual average yet is never flagged: there's nothing to compare it with.
 *
 * Sums are in cents; euros only in the answer.
 */

const db = require("../../db/databaseConnection.js");
const { findFirstRecordedDate } = require("../../db/firstRecordedDate.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { getOccurrenceDate } = require("./recurrenceSchedule.js");
const { getPostingBlocker } = require("./recurringTransactionPoster.js");
const { readAllSettings } = require("./appSettings.js");

const MONTHS_IN_THE_AVERAGE = 6;
const MONTHS_IN_THE_SPARKLINE = 12;
const DAYS_BEFORE_THE_PACE_MEANS_SOMETHING = 5; // same as Insights > This month
const UNCATEGORIZED_KEY = "uncategorized";

// "2026-10" + (−3) -> "2026-07"
function addMonthsToYearMonth(yearMonth, numberOfMonths) {
  const [year, month] = yearMonth.split("-").map(Number);
  const monthIndex = year * 12 + (month - 1) + numberOfMonths;
  return `${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, "0")}`;
}
const countDaysInMonth = (yearMonth) => new Date(Date.UTC(...yearMonth.split("-").map(Number), 0)).getUTCDate();

// The first month your records cover completely
function findFirstCompleteMonth() {
  const firstRecordedDate = findFirstRecordedDate(db);
  const firstMonth = firstRecordedDate.slice(0, 7);
  return firstRecordedDate.endsWith("-01") ? firstMonth : addMonthsToYearMonth(firstMonth, 1);
}

// Every expense of the window, with whether it's part of a trip (a tag with dates) and whether a rule added it
const selectExpensesBetween = db.prepare(`
  SELECT t.category_id, c.name AS category_name, c.spending_pace, t.amount, t.date, t.recurring_transaction_id IS NOT NULL AS is_recurring,
         EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id
                 WHERE tt.transaction_id = t.id AND (tg.start_date IS NOT NULL OR tg.end_date IS NOT NULL)) AS is_trip
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.type = 'expense' AND t.date >= ? AND t.date <= ?
`);
const selectExpenseCategories = db.prepare(`SELECT id, name, spending_pace FROM categories WHERE kind = 'expense'`);

// Recurring expenses not added yet whose date falls between tomorrow-ish (the next one due) and the month's end,
// per category key, in cents. Same rule as the frontend's month projection, plus paused / blocked rules skipped.
function sumRecurringExpensesStillDue(monthEnd) {
  const stillDueByCategoryKey = new Map();
  for (const rule of db.prepare(`SELECT * FROM recurring_transactions WHERE type = 'expense'`).all()) {
    if (getPostingBlocker(rule)) continue;
    const categoryKey = rule.category_id ?? UNCATEGORIZED_KEY;
    for (let index = rule.posted_count; index < rule.posted_count + 60; index++) {
      const date = getOccurrenceDate(rule, index);
      if (date > monthEnd || (rule.end_date && date > rule.end_date)) break;
      stillDueByCategoryKey.set(categoryKey, (stillDueByCategoryKey.get(categoryKey) ?? 0) + rule.amount);
    }
  }
  return stillDueByCategoryKey;
}

function buildCategoryTrends({ today = getTodayAsLocalDate(), settings = readAllSettings() } = {}) {
  const currentMonth = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = countDaysInMonth(currentMonth);
  const monthEnd = `${currentMonth}-${String(daysInMonth).padStart(2, "0")}`;
  const sparklineMonths = Array.from({ length: MONTHS_IN_THE_SPARKLINE }, (unused, index) => addMonthsToYearMonth(currentMonth, index - MONTHS_IN_THE_SPARKLINE + 1));
  const firstCompleteMonth = findFirstCompleteMonth();
  const averageMonths = Array.from({ length: MONTHS_IN_THE_AVERAGE }, (unused, index) => addMonthsToYearMonth(currentMonth, -1 - index))
    .filter((month) => month >= firstCompleteMonth)
    .reverse();
  const lastMonth = addMonthsToYearMonth(currentMonth, -1);
  const excludeTrips = settings.trend_exclude_trips === 1;

  // category key -> { name, totalByMonth (all), averageTotalByMonth (trips out if asked), thisMonthRecurring }
  const rowByKey = new Map();
  // spendingPace: "occasional" or "daily" (uncategorized counts as daily: it's usually the small stuff)
  const rowFor = (categoryId, name, spendingPace) => {
    const key = categoryId ?? UNCATEGORIZED_KEY;
    if (!rowByKey.has(key)) rowByKey.set(key, { categoryId, name: name ?? "Uncategorized", isOccasional: spendingPace === "occasional", totalByMonth: new Map(), averageTotalByMonth: new Map(), thisMonthRecurring: 0 });
    return rowByKey.get(key);
  };
  for (const category of selectExpenseCategories.all()) rowFor(category.id, category.name, category.spending_pace);

  let tripCentsLeftOut = 0;
  for (const expense of selectExpensesBetween.all(`${sparklineMonths[0]}-01`, today)) {
    const row = rowFor(expense.category_id, expense.category_name, expense.spending_pace);
    const month = expense.date.slice(0, 7);
    row.totalByMonth.set(month, (row.totalByMonth.get(month) ?? 0) + expense.amount);
    if (expense.is_trip && excludeTrips) {
      if (averageMonths.includes(month)) tripCentsLeftOut += expense.amount;
    } else {
      row.averageTotalByMonth.set(month, (row.averageTotalByMonth.get(month) ?? 0) + expense.amount);
    }
    if (month === currentMonth && expense.is_recurring) row.thisMonthRecurring += expense.amount;
  }

  const stillDueByKey = sumRecurringExpensesStillDue(monthEnd);
  const shareThreshold = settings.trend_highlight_share;
  const minimumDifferenceInCents = Math.round(settings.trend_highlight_minimum_euros * 100);

  const categories = [...rowByKey.entries()].map(([key, row]) => {
    const spentSoFar = row.totalByMonth.get(currentMonth) ?? 0;
    const variableSoFar = spentSoFar - row.thisMonthRecurring;
    const stillDue = stillDueByKey.get(key) ?? 0;
    const restOfTheMonthAtPace = row.isOccasional ? 0 : (variableSoFar / dayOfMonth) * (daysInMonth - dayOfMonth);
    const projected = Math.round(spentSoFar + stillDue + restOfTheMonthAtPace);
    const average = averageMonths.length
      ? Math.round(averageMonths.reduce((sum, month) => sum + (row.averageTotalByMonth.get(month) ?? 0), 0) / averageMonths.length)
      : null;
    const difference = average === null ? null : projected - average;
    const isRunningHot = average !== null && projected > average * (1 + shareThreshold) && difference >= minimumDifferenceInCents;
    return {
      category_id: row.categoryId,
      name: row.name,
      this_month: convertCentsToEuros(spentSoFar),
      projected: convertCentsToEuros(projected),
      last_month: convertCentsToEuros(row.totalByMonth.get(lastMonth) ?? 0),
      average: convertCentsToEuros(average),
      difference: convertCentsToEuros(difference),
      difference_share: average ? difference / average : null,
      is_running_hot: isRunningHot,
      sparkline: sparklineMonths.map((month) => ({ month, total: convertCentsToEuros(row.totalByMonth.get(month) ?? 0) })),
    };
  })
    // a category with nothing in 12 months (and nothing due) has no trend to show
    .filter((category) => category.projected > 0 || category.sparkline.some((point) => point.total > 0))
    .sort((first, second) => Number(second.is_running_hot) - Number(first.is_running_hot) || second.projected - first.projected || first.name.localeCompare(second.name));

  return {
    month: currentMonth,
    day_of_month: dayOfMonth,
    days_in_month: daysInMonth,
    is_early_in_the_month: dayOfMonth < DAYS_BEFORE_THE_PACE_MEANS_SOMETHING,
    months_in_average: averageMonths.length,
    average_months: averageMonths,
    excluding_trips: excludeTrips,
    trip_spending_left_out: convertCentsToEuros(tripCentsLeftOut),
    highlight_share: shareThreshold,
    highlight_minimum_euros: settings.trend_highlight_minimum_euros,
    categories,
  };
}

module.exports = { buildCategoryTrends, addMonthsToYearMonth };
