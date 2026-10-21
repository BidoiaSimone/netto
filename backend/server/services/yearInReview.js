/* YEAR IN REVIEW: one year of your money, read in a minute (the "Year in review" page)
 *
 * Built from what already exists, with no tables of its own:
 *   the statements of the year (services/financialStatements.js)   net worth at the start and the end, and how it
 *       changed: what you saved (income − expenses), what the investments did, and the rest (reconciliations,
 *       starting balances); income, expenses, savings rate; investment returns; the stamp duty estimate
 *   the year's transactions                                          top 5 expense categories, the categories that grew
 *       or shrank most against the same dates of the year before, and the best and worst month by savings
 *   the tags (services/tagReport.js)                                 the trips of the year: a trip is a tag with dates
 *   the targets (services/targetAllocation.js)                       the investments at the end of the year against
 *       your targets (today's targets: they have no history)
 *
 * The current year is shown year-to-date (up to today), and compared with the same dates of last year, not with the
 * whole of it: January–October against January–October. The best and worst month are picked among complete months. The year never starts before your first record, exactly
 * like the Statements page, so the two always show the same totals for the same year.
 * A part with nothing in it (no trips, no investments that year) is null, and the page leaves it out.
 */

const db = require("../../db/databaseConnection.js");
const { findFirstDayOfAnyRecord } = require("../../db/firstRecordedDate.js");
const { buildFinancialStatements } = require("./financialStatements.js");
const { buildTagReport } = require("./tagReport.js");
const { describeAllocation } = require("./targetAllocation.js");
const { addMonthsKeepingDay } = require("./recurrenceSchedule.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");

const TOP_CATEGORY_COUNT = 5;
const CATEGORY_CHANGE_COUNT = 3;
const toCents = (euros) => Math.round(euros * 100);
const MILLISECONDS_PER_DAY = 864e5;
const countDaysInclusive = (firstDay, lastDay) => Math.round((Date.parse(lastDay + "T00:00:00Z") - Date.parse(firstDay + "T00:00:00Z")) / MILLISECONDS_PER_DAY) + 1;

// The years with records, newest first: from the first record's year to this year
function listYearsWithRecords(today = getTodayAsLocalDate()) {
  const firstYear = Number(findFirstDayOfAnyRecord(db).slice(0, 4));
  const thisYear = Number(today.slice(0, 4));
  const years = [];
  for (let year = thisYear; year >= firstYear; year--) years.push(year);
  return years;
}

// { from, to, isYearToDate } for a year: never before the first record, never after today
function findPeriodOfYear(year, today) {
  const firstDayOfRecords = findFirstDayOfAnyRecord(db);
  const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
  const to = yearEnd > today ? today : yearEnd;
  const from = yearStart < firstDayOfRecords && firstDayOfRecords <= to ? firstDayOfRecords : yearStart;
  return { from, to, isYearToDate: to < yearEnd };
}

const selectExpensesByCategory = db.prepare(`
  SELECT t.category_id, COALESCE(c.name, 'Uncategorized') AS name, SUM(t.amount) AS total
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.type = 'expense' AND t.date BETWEEN ? AND ? GROUP BY t.category_id
`);
const selectMonthTotals = db.prepare(`
  SELECT substr(date, 1, 7) AS month,
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expenses
  FROM transactions WHERE date BETWEEN ? AND ? GROUP BY month ORDER BY month
`);
const selectTradeTotals = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN side = 'buy' THEN amount END), 0) AS bought, COALESCE(SUM(CASE WHEN side = 'sell' THEN amount END), 0) AS sold,
         COUNT(*) AS trade_count
  FROM investment_trades WHERE date BETWEEN ? AND ?
`);
const selectTargets = db.prepare(`SELECT ticker, target_basis_points FROM investment_targets`);

// Categories that grew or shrank most against the same dates one year earlier (null when that year has no data)
function compareCategoriesWithYearBefore(from, to, expensesThisYear) {
  const previousFrom = addMonthsKeepingDay(from, -12), previousTo = addMonthsKeepingDay(to, -12);
  const expensesYearBefore = selectExpensesByCategory.all(previousFrom, previousTo);
  if (!expensesYearBefore.length) return null;
  const rowsByKey = new Map();
  const keyOf = (row) => row.category_id ?? "uncategorized";
  for (const row of expensesYearBefore) rowsByKey.set(keyOf(row), { name: row.name, thisYear: 0, yearBefore: row.total });
  for (const row of expensesThisYear) {
    const existing = rowsByKey.get(keyOf(row)) ?? { name: row.name, thisYear: 0, yearBefore: 0 };
    rowsByKey.set(keyOf(row), { ...existing, name: row.name, thisYear: row.total });
  }
  const changes = [...rowsByKey.values()].map((row) => ({ ...row, change: row.thisYear - row.yearBefore }));
  const toApi = (row) => ({
    name: row.name, this_year: convertCentsToEuros(row.thisYear), year_before: convertCentsToEuros(row.yearBefore), change: convertCentsToEuros(row.change),
    change_share: row.yearBefore ? row.change / row.yearBefore : null,
  });
  return {
    compared_with: { from: previousFrom, to: previousTo },
    grew: changes.filter((row) => row.change > 0).sort((first, second) => second.change - first.change).slice(0, CATEGORY_CHANGE_COUNT).map(toApi),
    shrank: changes.filter((row) => row.change < 0).sort((first, second) => first.change - second.change).slice(0, CATEGORY_CHANGE_COUNT).map(toApi),
  };
}

// The year's trips: tags with dates that overlap the year. Their totals are the whole trip's, whatever the dates of
// its transactions (a flight booked in December for a January trip is still the trip's).
function listTripsOfYear(year) {
  const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
  return buildTagReport()
    .filter((tag) => tag.start_date || tag.end_date)
    .filter((tag) => (tag.start_date ?? tag.end_date) <= yearEnd && (tag.end_date ?? tag.start_date) >= yearStart)
    .map((tag) => {
      const days = tag.start_date && tag.end_date ? countDaysInclusive(tag.start_date, tag.end_date) : null;
      const cost = -tag.net; // what the trip cost overall: spent − anything received back
      return {
        name: tag.name, start_date: tag.start_date, end_date: tag.end_date, days,
        spent: tag.spent, received: tag.received, cost, cost_per_day: days ? Math.round((cost / days) * 100) / 100 : null,
        exchange_cost: tag.exchange_cost, currencies: tag.by_currency.map((row) => row.currency), transaction_count: tag.transaction_count,
      };
    })
    .sort((first, second) => (first.start_date ?? first.end_date).localeCompare(second.start_date ?? second.end_date));
}

// Investments in the year: money put in, the year's returns, and where the portfolio ended against the targets
function summarizeInvestments(from, to, statements) {
  const { bought, sold, trade_count: tradeCount } = selectTradeTotals.get(from, to);
  const returns = statements.investment_returns;
  const investmentsClass = statements.balance_sheet.classes.find((liquidityClass) => liquidityClass.key === "investments");
  const heldAtSomePoint = investmentsClass && (investmentsClass.opening > 0 || investmentsClass.closing > 0);
  if (!tradeCount && !heldAtSomePoint) return null;

  const targetBasisPointsByTicker = new Map(selectTargets.all().map((row) => [row.ticker, row.target_basis_points]));
  const holdingsAtEnd = (investmentsClass?.items ?? []).filter((item) => item.closing > 0).map((item) => ({ ticker: item.name, valueInCents: toCents(item.closing) }));
  const allocation = describeAllocation(holdingsAtEnd, targetBasisPointsByTicker).map((row) => ({
    ticker: row.ticker, value: convertCentsToEuros(row.valueInCents), share: row.currentShare, target_share: row.targetShare, drift_points: row.driftPoints,
  }));
  return {
    bought: convertCentsToEuros(bought),
    sold: convertCentsToEuros(sold),
    net_put_in: convertCentsToEuros(bought - sold),
    value_at_start: investmentsClass?.opening ?? 0,
    value_at_end: investmentsClass?.closing ?? 0,
    gain: returns.total.gain,
    money_weighted: returns.total.money_weighted,
    time_weighted: returns.total.time_weighted,
    days: returns.days,
    allocation,
    targets_set: targetBasisPointsByTicker.size > 0,
  };
}

async function buildYearInReview(year, { today = getTodayAsLocalDate() } = {}) {
  const { from, to, isYearToDate } = findPeriodOfYear(year, today);
  const statements = await buildFinancialStatements(from, to);
  const incomeStatement = statements.income_statement;
  const stepAmount = (key) => statements.bridge.steps.find((step) => step.key === key).amount;

  // net worth: the change split into what you saved, what the investments did, and the rest
  const savedInCents = toCents(stepAmount("income")) + toCents(stepAmount("expenses"));
  const investmentResultsInCents = toCents(stepAmount("investment_results"));
  const changeInCents = toCents(statements.bridge.closing) - toCents(statements.bridge.opening);
  const netWorth = {
    start: statements.bridge.opening,
    end: statements.bridge.closing,
    change: convertCentsToEuros(changeInCents),
    from_savings: convertCentsToEuros(savedInCents),
    from_investments: convertCentsToEuros(investmentResultsInCents),
    other: convertCentsToEuros(changeInCents - savedInCents - investmentResultsInCents), // reconciliations, starting balances
  };

  const expensesThisYear = selectExpensesByCategory.all(from, to);
  const totalExpensesInCents = toCents(incomeStatement.total_expenses);
  const topExpenseCategories = [...expensesThisYear].sort((first, second) => second.total - first.total).slice(0, TOP_CATEGORY_COUNT)
    .map((row) => ({ name: row.name, total: convertCentsToEuros(row.total), share: totalExpensesInCents ? row.total / totalExpensesInCents : 0 }));

  const months = selectMonthTotals.all(from, to).map((row) => ({
    month: row.month, income: convertCentsToEuros(row.income), expenses: convertCentsToEuros(row.expenses), saved: convertCentsToEuros(row.income - row.expenses),
  }));
  // best and worst among complete months only: the month still running would almost always look like the worst
  const lastDayOfMonth = (yearMonth) => new Date(Date.UTC(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const completeMonths = months.filter((month) => lastDayOfMonth(month.month) <= to);
  const bySavings = [...completeMonths].sort((first, second) => second.saved - first.saved);

  const trips = listTripsOfYear(year);
  const periodTaxes = statements.tax_estimates.period;

  return {
    year, from, to, is_year_to_date: isYearToDate,
    years_available: listYearsWithRecords(today),
    net_worth: netWorth,
    income: incomeStatement.total_income,
    expenses: incomeStatement.total_expenses,
    net_savings: incomeStatement.net_savings,
    savings_rate: incomeStatement.savings_rate,
    top_expense_categories: topExpenseCategories,
    category_changes: compareCategoriesWithYearBefore(from, to, expensesThisYear),
    months,
    best_month: bySavings[0] ?? null,
    worst_month: bySavings.length > 1 ? bySavings.at(-1) : null,
    trips: trips.length ? trips : null,
    investments: summarizeInvestments(from, to, statements),
    stamp_duty: {
      securities: periodTaxes.stamp_duty_on_securities,
      current_accounts: periodTaxes.stamp_duty_on_current_accounts,
      total: convertCentsToEuros(toCents(periodTaxes.stamp_duty_on_securities) + toCents(periodTaxes.stamp_duty_on_current_accounts)),
    },
  };
}

module.exports = { buildYearInReview, listYearsWithRecords, findPeriodOfYear };
