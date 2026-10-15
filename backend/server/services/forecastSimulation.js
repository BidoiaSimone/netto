/* THE FORECAST SIMULATION: the maths only, no database (services/forecast.js gives it real data)
 *
 * Starts from today's values and steps forward one month at a time (point 0 = today, point k = k months later).
 * Each month, in this order:
 *
 *   1. investments grow        × (1 + yearly return)^(1/12)   twelve of these make exactly one year's return
 *   2. personal-use assets     × (1 − yearly depreciation)^(1/12)   (the car loses value, a bit each month)
 *   3. the month's money       income − expenses of the phase that month falls in. Phase amounts are in today's
 *                              euros, so they are raised with inflation: × (1 + inflation)^(k/12) in month k
 *                              (your rent and your salary will both cost/pay more in euros in 5 years)
 *        a surplus            goes to cash, or to investments (an assumption)
 *        a deficit            always comes out of cash
 *   4. one-off events          their amount goes to (or comes out of) cash; one that sells an asset removes it
 *   5. cash below zero         investments are sold to cover the gap; if there aren't enough, cash stays negative
 *                              (a shortfall: money you'd have to find somewhere)
 *
 * Everything is in nominal euros (the euros of each month). "Today's euros" divides by the deflator
 * (1 + inflation)^(k/12): it shows what that amount could buy at today's prices. Taxes aren't modelled.
 * Money is in cents; values keep their fractions while simulating and are rounded only when returned.
 */

const { addMonthsKeepingDay } = require("./recurrenceSchedule.js");

const monthOf = (date) => date.slice(0, 7);

// The phase a month falls in: the last one started on or before it. Before the first one starts, the first one
// applies (the earliest phase is "now"). null when there are no phases at all.
function findPhaseOfMonth(phasesInOrder, month) {
  let activePhase = phasesInOrder[0] ?? null;
  for (const phase of phasesInOrder) if (phase.fromMonth <= month) activePhase = phase;
  return activePhase;
}

// See the top of the file. Returns { points, cashRunsOut, investmentsRunOut, largestShortfall, lowestCash, ignoredEvents }.
function simulateForecast({ startDate, months, start, phases, events, assumptions }) {
  const phasesInOrder = [...phases].sort((first, second) => (first.fromMonth < second.fromMonth ? -1 : 1));
  const monthlyGrowth = Math.pow(1 + assumptions.yearlyReturn, 1 / 12);
  const monthlyDepreciation = Math.pow(1 - assumptions.yearlyDepreciation, 1 / 12);
  const monthlyInflation = Math.pow(1 + assumptions.yearlyInflation, 1 / 12);

  let cash = start.cash, investments = start.investments;
  const assetValues = new Map(start.personalUseAssets.map((asset) => [asset.accountId, asset.value]));
  const sumOfAssets = () => [...assetValues.values()].reduce((sum, value) => sum + value, 0);

  const startMonth = monthOf(startDate);
  // events in this month or before have already happened (or not): they're for the user to fix, not to apply
  const ignoredEvents = events.filter((event) => event.month <= startMonth);
  const eventsByMonth = new Map();
  for (const event of events) {
    if (event.month <= startMonth) continue;
    if (!eventsByMonth.has(event.month)) eventsByMonth.set(event.month, []);
    eventsByMonth.get(event.month).push(event);
  }

  let cashRunsOut = null, investmentsRunOut = null, largestShortfall = 0;
  const createPoint = (date, step, phase, investmentsSold) => ({
    date, month: monthOf(date), step,
    cash: Math.round(cash), investments: Math.round(investments), personalUse: Math.round(sumOfAssets()),
    netWorth: Math.round(cash + investments + sumOfAssets()),
    deflator: Math.pow(monthlyInflation, step),
    phaseName: phase?.name ?? null,
    investmentsSold: Math.round(investmentsSold),
  });
  const points = [createPoint(startDate, 0, findPhaseOfMonth(phasesInOrder, startMonth), 0)];
  let lowestCash = { value: points[0].cash, date: startDate };

  for (let step = 1; step <= months; step++) {
    const date = addMonthsKeepingDay(startDate, step);
    const month = monthOf(date);
    const phase = findPhaseOfMonth(phasesInOrder, month);

    investments *= monthlyGrowth;                                          // 1
    for (const [accountId, value] of assetValues) assetValues.set(accountId, value * monthlyDepreciation); // 2

    const inflationSoFar = Math.pow(monthlyInflation, step);               // 3
    const monthlySavings = phase ? (phase.monthlyIncome - phase.monthlyExpenses) * inflationSoFar : 0;
    if (monthlySavings > 0 && assumptions.savingsGoTo === "investments") investments += monthlySavings;
    else cash += monthlySavings;

    for (const event of eventsByMonth.get(month) ?? []) {                  // 4
      cash += event.amount;
      if (event.sellsAccountId != null) assetValues.delete(event.sellsAccountId);
    }

    let investmentsSold = 0;                                               // 5
    if (cash < 0) {
      cashRunsOut ??= { date, month };
      investmentsSold = Math.min(investments, -cash);
      investments -= investmentsSold;
      cash += investmentsSold;
      if (cash < -0.5) { // still short by more than half a cent: the investments are gone too
        investmentsRunOut ??= { date, month };
        largestShortfall = Math.max(largestShortfall, -cash);
      }
    }

    const point = createPoint(date, step, phase, investmentsSold);
    points.push(point);
    if (point.cash < lowestCash.value) lowestCash = { value: point.cash, date };
  }

  return { points, cashRunsOut, investmentsRunOut, largestShortfall: Math.round(largestShortfall), lowestCash, ignoredEvents };
}

// How many months the money that can be spent (cash + investments) lasts at a phase's monthly deficit, in
// today's euros and without returns: a simple, slightly cautious answer. null when the phase isn't a deficit.
function calculateRunwayInMonths(liquidMoney, phase) {
  if (!phase) return null;
  const monthlyDeficit = phase.monthlyExpenses - phase.monthlyIncome;
  if (monthlyDeficit <= 0) return null;
  return liquidMoney / monthlyDeficit;
}

module.exports = { simulateForecast, findPhaseOfMonth, calculateRunwayInMonths };
