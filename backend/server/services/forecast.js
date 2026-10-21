/* THE FORECAST PAGE'S DATA: real starting values and history, your plan (phases, events, assumptions),
 * and the simulation of the years ahead (services/forecastSimulation.js does the maths).
 *
 * Three groups, the same on the chart's history and forecast sides:
 *   cash          cash & equivalents + restricted (meal vouchers get spent on food like any cash)
 *   investments   holdings at today's price (or at cost if there's no price)
 *   personal use  the car and the like, at the value you gave them
 *
 * Default plan: with no phases saved, one phase "Now" is suggested from your real numbers:
 *   income and expenses = the average of the last complete months (up to 6). A month only counts if your
 *   records cover all of it. With no complete month yet, this month so far is projected to its end like the
 *   Insights projection: recurring expenses by their dates (also the ones still due), one-off categories
 *   as spent, habitual ones at this month's daily pace; income as received. If budgets exist, expenses = the
 *   budgets + the spending in categories without a budget.
 *
 * FIRE number (services/fireNumber.js): yearly expenses ÷ the withdrawal rate, from the plan's last phase or the
 * last 12 months' real expenses (both settings), and the month the forecast's cash + investments reach it.
 */

const db = require("../../db/databaseConnection.js");
const { ACCOUNT_KINDS } = require("../../config/accountKinds.js");
const { findFirstRecordedDate } = require("../../db/firstRecordedDate.js");
const { calculateInvestmentsValuePerDay } = require("./netWorthHistory.js");
const { addMonthsKeepingDay } = require("./recurrenceSchedule.js");
const { findLimitsInEffect, sumRecurringExpensesStillDue } = require("./budgetCalculator.js");
const { simulateForecast, findPhaseOfMonth, calculateRunwayInMonths } = require("./forecastSimulation.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { calculateFireNumber, findWhenFireNumberIsReached } = require("./fireNumber.js");
const { readAllSettings } = require("./appSettings.js");

const MONTHS_OF_HISTORY_SHOWN = 12;
const MONTHS_OF_DATA_FOR_AVERAGES = 6;
const DEFAULT_FORECAST_YEARS = 10;
const KEY_NUMBER_YEARS = [1, 2, 5, 10];
const BAND_RETURNS = { low: 0, high: 0.08 }; // the uncertainty band: what 0% and 8% a year would give

const padTwoDigits = (number) => String(number).padStart(2, "0");
const countDaysInMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const previousMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${padTwoDigits(month - 1)}`;
};
const monthName = (yearMonth) => new Date(yearMonth + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

// ---------- your plan, as stored ----------

const loadPhases = () => db.prepare(`SELECT * FROM forecast_phases ORDER BY from_month`).all()
  .map((row) => ({ id: row.id, name: row.name, fromMonth: row.from_month, monthlyIncome: row.monthly_income, monthlyExpenses: row.monthly_expenses }));
const loadEvents = () => db.prepare(`SELECT * FROM forecast_events ORDER BY month, id`).all()
  .map((row) => ({ id: row.id, name: row.name, month: row.month, amount: row.amount, sellsAccountId: row.sells_account_id,
    transfersWithInvestments: row.transfers_with_investments === 1 }));
function loadAssumptions() {
  const row = db.prepare(`SELECT * FROM forecast_assumptions WHERE id = 1`).get();
  return { yearlyReturn: row.yearly_return, yearlyInflation: row.yearly_inflation, savingsGoTo: row.savings_go_to, yearlyDepreciation: row.yearly_depreciation };
}

// ---------- your real averages (the suggested first phase) ----------

const sumOfType = (type, firstDay, lastDay) =>
  db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = ? AND date BETWEEN ? AND ?`).get(type, firstDay, lastDay).total;

// Expenses in categories without a budget this month (uncategorized included)
function sumOfUnbudgetedExpenses(firstDay, lastDay, budgetedCategoryIds) {
  const rows = db.prepare(`SELECT category_id, SUM(amount) AS total FROM transactions WHERE type = 'expense' AND date BETWEEN ? AND ? GROUP BY category_id`).all(firstDay, lastDay);
  return rows.filter((row) => !budgetedCategoryIds.has(row.category_id)).reduce((sum, row) => sum + row.total, 0);
}

// This month's expenses projected to the month's end, the same way as Insights > This month (cents):
//   recurring       already added + still due before the month ends
//   one-off     (spending_pace 'occasional', migration 16) as spent: one purchase says nothing about the rest
//   habitual    everything else, at the daily pace of the days observed
// Categories in `leftOutCategoryIds` (the budgeted ones, counted by their budget instead) are skipped.
function projectThisMonthExpenses({ firstDay, today, daysObserved, daysInMonth, leftOutCategoryIds }) {
  const rows = db.prepare(`
    SELECT t.category_id, t.recurring_transaction_id IS NOT NULL AS is_recurring, c.spending_pace, SUM(t.amount) AS total
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND t.date BETWEEN ? AND ?
    GROUP BY t.category_id, is_recurring
  `).all(firstDay, today);
  let projected = 0;
  for (const row of rows) {
    if (leftOutCategoryIds.has(row.category_id)) continue;
    const countedAsIs = row.is_recurring || row.spending_pace === "occasional";
    projected += countedAsIs ? row.total : (row.total / daysObserved) * daysInMonth;
  }
  const monthEnd = `${today.slice(0, 7)}-${padTwoDigits(daysInMonth)}`;
  for (const [categoryId, stillDue] of sumRecurringExpensesStillDue(today, monthEnd)) {
    if (!leftOutCategoryIds.has(categoryId)) projected += stillDue;
  }
  return projected;
}

// { monthlyIncome, monthlyExpenses (cents), monthsOfData, source (a sentence for the page), usesBudgets }
// today: YYYY-MM-DD (a parameter so the tests can choose it)
// useBudgets: false = always what was really spent, budgets or not (the emergency fund on Insights uses that)
function calculateRealAverages(today, { useBudgets = true } = {}) {
  const currentMonth = today.slice(0, 7);
  const firstRecordedDay = findFirstRecordedDate(db);
  const completeMonths = [];
  for (let month = previousMonth(currentMonth); completeMonths.length < MONTHS_OF_DATA_FOR_AVERAGES && `${month}-01` >= firstRecordedDay; month = previousMonth(month)) {
    completeMonths.push(month);
  }

  const limits = useBudgets ? findLimitsInEffect(currentMonth) : new Map();
  const usesBudgets = limits.size > 0;
  const totalOfBudgets = [...limits.values()].reduce((sum, limit) => sum + limit, 0);
  const budgetedCategoryIds = new Set(limits.keys());
  const budgetsText = usesBudgets ? " Expenses = your budgets + what categories without a budget usually cost." : "";

  if (completeMonths.length) {
    const firstDay = `${completeMonths[completeMonths.length - 1]}-01`;
    const lastDay = `${completeMonths[0]}-${countDaysInMonth(completeMonths[0])}`;
    const count = completeMonths.length;
    const averageExpenses = usesBudgets
      ? totalOfBudgets + sumOfUnbudgetedExpenses(firstDay, lastDay, budgetedCategoryIds) / count
      : sumOfType("expense", firstDay, lastDay) / count;
    return {
      monthlyIncome: Math.round(sumOfType("income", firstDay, lastDay) / count),
      monthlyExpenses: Math.round(averageExpenses),
      monthsOfData: count,
      usesBudgets,
      source: `Average of the last ${count === 1 ? "complete month" : `${count} complete months`} (${monthName(completeMonths[completeMonths.length - 1])}${count > 1 ? ` – ${monthName(completeMonths[0])}` : ""}).${budgetsText}`,
    };
  }

  // no complete month yet: this month so far, its expenses at the daily pace
  const firstDayObserved = firstRecordedDay > `${currentMonth}-01` ? firstRecordedDay : `${currentMonth}-01`;
  const daysObserved = Math.max(1, Number(today.slice(8)) - Number(firstDayObserved.slice(8)) + 1);
  const daysInMonth = countDaysInMonth(currentMonth);
  const monthlyExpenses = (usesBudgets ? totalOfBudgets : 0)
    + projectThisMonthExpenses({ firstDay: firstDayObserved, today, daysObserved, daysInMonth, leftOutCategoryIds: budgetedCategoryIds });
  return {
    monthlyIncome: sumOfType("income", firstDayObserved, today),
    monthlyExpenses: Math.round(monthlyExpenses),
    monthsOfData: 0,
    usesBudgets,
    source: `No complete month of records yet: ${monthName(currentMonth)} so far (${daysObserved} day${daysObserved === 1 ? "" : "s"}), `
      + `expenses projected to the month's end like on Insights (habitual categories at the daily pace, one-off ones as spent, `
      + `recurring by their dates), income as received. A rough start: adjust it.${budgetsText}`,
  };
}

// The real expenses of the last 12 complete months, per year (cents), and how many months that is: fewer when your
// records are younger (then scaled to a year). Null with no complete month yet.
function calculateExpensesOfLastTwelveMonths(today) {
  const firstRecordedDay = findFirstRecordedDate(db);
  const completeMonths = [];
  for (let month = previousMonth(today.slice(0, 7)); completeMonths.length < 12 && `${month}-01` >= firstRecordedDay; month = previousMonth(month)) completeMonths.push(month);
  if (!completeMonths.length) return null;
  const total = sumOfType("expense", `${completeMonths.at(-1)}-01`, `${completeMonths[0]}-${countDaysInMonth(completeMonths[0])}`);
  return { yearlyExpenses: Math.round((total / completeMonths.length) * 12), monthsOfData: completeMonths.length };
}

// The FIRE block of the answer (euros). lastPhase: the plan's last phase (or the suggested one).
function buildFireNumber({ today, lastPhase, start, points, settings }) {
  const lastTwelveMonths = calculateExpensesOfLastTwelveMonths(today);
  const useLastTwelveMonths = settings.fire_expenses_from_last_12_months === 1 && lastTwelveMonths !== null;
  const yearlyExpenses = useLastTwelveMonths ? lastTwelveMonths.yearlyExpenses : lastPhase.monthlyExpenses * 12;
  const fireNumber = calculateFireNumber(yearlyExpenses, settings.fire_withdrawal_rate);
  const countedNow = start.cash + start.investments;
  const reachedAt = findWhenFireNumberIsReached(points, fireNumber);
  return {
    withdrawal_rate: settings.fire_withdrawal_rate,
    expenses_from: useLastTwelveMonths ? "last_12_months" : "last_phase",
    yearly_expenses: convertCentsToEuros(yearlyExpenses),
    fire_number: convertCentsToEuros(fireNumber),         // today's euros; null without expenses
    counted_now: convertCentsToEuros(countedNow),         // cash + investments, not the car
    share_now: fireNumber ? countedNow / fireNumber : null,
    reached_on: reachedAt?.date ?? null,                  // null = not within the forecast
    last_phase: { name: lastPhase.name, yearly_expenses: convertCentsToEuros(lastPhase.monthlyExpenses * 12) },
    last_12_months: lastTwelveMonths && { yearly_expenses: convertCentsToEuros(lastTwelveMonths.yearlyExpenses), months_of_data: lastTwelveMonths.monthsOfData },
  };
}

// ---------- real values: today and the months before ----------

// cash, personal-use total and each personal-use asset on each day (cents), from the accounts' history
function calculateAccountGroupsOnDays(days) {
  const accounts = db.prepare(`
    SELECT a.id, a.name, a.kind, a.opening_balance,
           MIN(a.open_date, COALESCE((SELECT MIN(date) FROM transactions WHERE from_account_id = a.id OR to_account_id = a.id), a.open_date)) AS start_day
    FROM accounts a
  `).all();
  const balanceOnDay = db.prepare(`
    SELECT COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = $id AND date <= $day), 0)
         - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = $id AND date <= $day), 0) AS movement
  `);
  return days.map((day) => {
    let cash = 0;
    const personalUseAssets = [];
    for (const account of accounts) {
      const balance = (account.start_day <= day ? account.opening_balance : 0) + balanceOnDay.get({ id: account.id, day }).movement;
      if (ACCOUNT_KINDS[account.kind].liquidity === "personal_use") personalUseAssets.push({ accountId: account.id, name: account.name, value: balance });
      else cash += balance; // cash & equivalents and restricted
    }
    return { cash, personalUseAssets, personalUse: personalUseAssets.reduce((sum, asset) => sum + asset.value, 0) };
  });
}

// The last months (same day of the month as today, from your first record on) and today, oldest first
function listHistoryDays(today) {
  const firstRecordedDay = findFirstRecordedDate(db);
  const days = [];
  for (let monthsBack = MONTHS_OF_HISTORY_SHOWN; monthsBack >= 1; monthsBack--) {
    const day = addMonthsKeepingDay(today, -monthsBack);
    if (day >= firstRecordedDay) days.push(day);
  }
  days.push(today);
  return days;
}

// ---------- everything together ----------

// today: YYYY-MM-DD. Money in euros in the answer; everything else as described at the top.
async function buildForecast(today, { years = DEFAULT_FORECAST_YEARS } = {}) {
  const months = years * 12;
  const historyDays = listHistoryDays(today);
  const accountGroups = calculateAccountGroupsOnDays(historyDays);
  const investmentValues = (await calculateInvestmentsValuePerDay(historyDays)).totals;
  const todayGroups = accountGroups[accountGroups.length - 1];

  const storedPhases = loadPhases();
  const averages = calculateRealAverages(today);
  const suggestedPhase = { id: null, name: "Now (your averages)", fromMonth: today.slice(0, 7), monthlyIncome: averages.monthlyIncome, monthlyExpenses: averages.monthlyExpenses };
  const phases = storedPhases.length ? storedPhases : [suggestedPhase];
  const events = loadEvents();
  const assumptions = loadAssumptions();

  const start = { cash: todayGroups.cash, investments: investmentValues[investmentValues.length - 1], personalUseAssets: todayGroups.personalUseAssets.filter((asset) => asset.value > 0) };
  const simulate = (yearlyReturn) => simulateForecast({ startDate: today, months, start, phases, events, assumptions: { ...assumptions, yearlyReturn } });
  const result = simulate(assumptions.yearlyReturn);
  const lowBand = simulate(BAND_RETURNS.low), highBand = simulate(BAND_RETURNS.high);

  const toEuros = convertCentsToEuros;
  const pointToApi = (point) => ({
    date: point.date, cash: toEuros(point.cash), investments: toEuros(point.investments), personal_use: toEuros(point.personalUse),
    net_worth: toEuros(point.netWorth), deflator: point.deflator, phase_name: point.phaseName, investments_sold: toEuros(point.investmentsSold),
  });
  const phaseNow = findPhaseOfMonth([...phases].sort((first, second) => (first.fromMonth < second.fromMonth ? -1 : 1)), today.slice(0, 7));
  const liquidNow = start.cash + start.investments;
  const runwayInMonths = calculateRunwayInMonths(liquidNow, phaseNow);

  const lastPhase = [...phases].sort((first, second) => (first.fromMonth < second.fromMonth ? -1 : 1)).at(-1);
  const fire = buildFireNumber({ today, lastPhase, start, points: result.points, settings: readAllSettings() });

  return {
    today,
    years,
    fire,
    assumptions: { yearly_return: assumptions.yearlyReturn, yearly_inflation: assumptions.yearlyInflation, savings_go_to: assumptions.savingsGoTo, yearly_depreciation: assumptions.yearlyDepreciation },
    // each phase lasts until the next one starts; the first one also covers today
    phases: storedPhases.map((phase, index) => ({
      id: phase.id, name: phase.name, from_month: phase.fromMonth,
      until_month: storedPhases[index + 1] ? previousMonth(storedPhases[index + 1].fromMonth) : null,
      monthly_income: toEuros(phase.monthlyIncome), monthly_expenses: toEuros(phase.monthlyExpenses),
    })),
    suggested_phase: storedPhases.length ? null : { name: suggestedPhase.name, from_month: suggestedPhase.fromMonth, monthly_income: toEuros(suggestedPhase.monthlyIncome), monthly_expenses: toEuros(suggestedPhase.monthlyExpenses) },
    averages: { monthly_income: toEuros(averages.monthlyIncome), monthly_expenses: toEuros(averages.monthlyExpenses), months_of_data: averages.monthsOfData, uses_budgets: averages.usesBudgets, source: averages.source },
    events: events.map((event) => ({
      id: event.id, name: event.name, month: event.month, amount: toEuros(event.amount), sells_account_id: event.sellsAccountId,
      transfers_with_investments: event.transfersWithInvestments,
      is_past: result.ignoredEvents.includes(event),
    })),
    personal_use_assets: todayGroups.personalUseAssets.map((asset) => ({ account_id: asset.accountId, name: asset.name, value: toEuros(asset.value) })),
    history: historyDays.slice(0, -1).map((day, index) => ({
      date: day, cash: toEuros(accountGroups[index].cash), investments: toEuros(investmentValues[index]), personal_use: toEuros(accountGroups[index].personalUse),
      net_worth: toEuros(accountGroups[index].cash + investmentValues[index] + accountGroups[index].personalUse),
    })),
    forecast: result.points.map(pointToApi),
    band: {
      low_return: BAND_RETURNS.low, high_return: BAND_RETURNS.high,
      low: lowBand.points.map((point) => toEuros(point.netWorth)), high: highBand.points.map((point) => toEuros(point.netWorth)),
    },
    warnings: {
      cash_runs_out: result.cashRunsOut,
      investments_run_out: result.investmentsRunOut,
      largest_shortfall: toEuros(result.largestShortfall),
    },
    key_numbers: {
      net_worth_in: KEY_NUMBER_YEARS.filter((yearsAhead) => yearsAhead <= years).map((yearsAhead) => {
        const point = result.points[yearsAhead * 12];
        return { years: yearsAhead, date: point.date, net_worth: toEuros(point.netWorth), deflator: point.deflator };
      }),
      lowest_cash: { value: toEuros(result.lowestCash.value), date: result.lowestCash.date },
      runway: {
        months: runwayInMonths === null ? null : Math.round(runwayInMonths * 10) / 10,
        phase_name: phaseNow?.name ?? null,
        monthly_deficit: phaseNow ? toEuros(phaseNow.monthlyExpenses - phaseNow.monthlyIncome) : null,
        liquid_now: toEuros(liquidNow),
      },
    },
  };
}

module.exports = { buildForecast, calculateRealAverages };
