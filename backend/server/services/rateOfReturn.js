/* RATES OF RETURN: the maths only, no database (services/investmentReturns.js feeds it real data)
 *
 * MONEY-WEIGHTED RETURN (MWR, also "internal rate of return"; XIRR in Excel)
 *   The one interest rate that makes all the money you put in and took out, each on its date, worth zero today:
 *       Σ amount_i / (1 + r)^(t_i)  =  0          (money in negative, money out positive, t_i in years)
 *   It answers "what did MY money earn?": a big buy just before a fall weighs a lot, so it includes your timing.
 *   There is no formula for r, so it's found numerically: Newton's method first (fast: it follows the slope of
 *   the curve), and if that wanders off (it can, with odd cash flows), bisection, which is slow but can't miss a
 *   root once it has a value on each side of it.
 *
 * TIME-WEIGHTED RETURN (TWR)
 *   Cuts the period at every buy and sell, takes the return of each piece, and chains them:
 *       (1 + r_1) × (1 + r_2) × … − 1
 *   Money coming in or going out doesn't change it, so it answers "how did the INVESTMENTS do?", the number a
 *   fund publishes. TWR − MWR is roughly what your timing added (or cost).
 */

const MILLISECONDS_PER_DAY = 864e5;
const DAYS_PER_YEAR = 365; // Excel's XIRR uses 365 too, also in leap years

const countDaysBetween = (firstDay, lastDay) => Math.round((Date.parse(lastDay + "T00:00:00Z") - Date.parse(firstDay + "T00:00:00Z")) / MILLISECONDS_PER_DAY);

// ---------- solving Σ amount / (1+r)^time = 0 ----------

// flows: [{ time, amount }], time in any unit (years for XIRR). The value of the flows at rate r, and its slope.
function presentValue(flows, rate) {
  return flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, flow.time), 0);
}
function presentValueSlope(flows, rate) {
  return flows.reduce((sum, flow) => sum - (flow.time * flow.amount) / Math.pow(1 + rate, flow.time + 1), 0);
}

const NEWTON_START = 0.1;          // Excel's default guess
const NEWTON_MAXIMUM_STEPS = 100;
const PRECISION = 1e-10;
const LOWEST_RATE = -0.999999999;  // −100% would divide by zero: losing everything is as low as it goes
const HIGHEST_RATE_TRIED = 1e12;

function solveWithNewton(flows) {
  let rate = NEWTON_START;
  for (let step = 0; step < NEWTON_MAXIMUM_STEPS; step++) {
    const value = presentValue(flows, rate), slope = presentValueSlope(flows, rate);
    if (!Number.isFinite(value) || !Number.isFinite(slope) || slope === 0) return null;
    const nextRate = rate - value / slope;
    if (!Number.isFinite(nextRate) || nextRate <= -1) return null; // stepped off the curve: let bisection try
    if (Math.abs(nextRate - rate) < PRECISION) return nextRate;
    rate = nextRate;
  }
  return null;
}

function solveWithBisection(flows) {
  let low = LOWEST_RATE, high = 1;
  const signAt = (rate) => Math.sign(presentValue(flows, rate));
  while (signAt(low) === signAt(high) && high < HIGHEST_RATE_TRIED) high *= 10; // widen until the root is inside
  if (signAt(low) === signAt(high)) return null;
  for (let step = 0; step < 300 && high - low > PRECISION * Math.max(1, Math.abs(low)); step++) {
    const middle = (low + high) / 2;
    if (signAt(middle) === signAt(low)) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// The rate per time unit that zeroes the flows, or null when there isn't one: no flows, all zero, or all of the
// same sign (money only in, or only out, has no rate of return).
function solveRateOfReturn(flows) {
  const nonZeroFlows = flows.filter((flow) => flow.amount !== 0);
  if (!nonZeroFlows.some((flow) => flow.amount > 0) || !nonZeroFlows.some((flow) => flow.amount < 0)) return null;
  const newtonRate = solveWithNewton(nonZeroFlows);
  // Newton can land on a "root" where the value isn't really ~0 (flat curve): check it, else bisect
  const scale = nonZeroFlows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  if (newtonRate !== null && Math.abs(presentValue(nonZeroFlows, newtonRate)) <= 1e-7 * scale) return newtonRate;
  return solveWithBisection(nonZeroFlows);
}

// Excel's XIRR: cashFlows [{ date: "YYYY-MM-DD", amount }], time counted in years of 365 days from the FIRST
// flow in the list (like Excel). Returns the yearly rate (0.1 = 10%) or null.
function calculateXirr(cashFlows) {
  if (!cashFlows.length) return null;
  const firstDate = cashFlows[0].date;
  return solveRateOfReturn(cashFlows.map((flow) => ({ time: countDaysBetween(firstDate, flow.date) / DAYS_PER_YEAR, amount: flow.amount })));
}

// ---------- returns of a period ----------

// A period's return turned into a yearly one: (1 + r)^(365 / days) − 1. null when it would be meaningless
// (no days) or explode (a few days of +20% "annualize" to astronomical numbers).
function annualizeReturn(periodReturn, days) {
  if (periodReturn === null || days <= 0) return null;
  const yearly = Math.pow(1 + periodReturn, DAYS_PER_YEAR / days) - 1;
  return Number.isFinite(yearly) && Math.abs(yearly) < 1e6 ? yearly : null;
}

// Money-weighted return of a period from startDay to endDay:
//   startValue  what the investments were worth at the end of startDay (counted as money put in that day)
//   trades      [{ date, side: "buy" | "sell", amount }], amount = cash paid or received (fees included)
//   endValue    what they were worth at the end of endDay (counted as money taken out that day)
// Solved with the period itself as the time unit, so the result is the return OVER the period: a 1-day
// period can't blow up into a giant yearly number on the way. Returns { period, annual } or null.
function calculateMoneyWeightedReturn({ startDay, endDay, startValue, trades, endValue }) {
  const days = countDaysBetween(startDay, endDay);
  if (days <= 0) return null;
  const flows = [
    { time: 0, amount: -startValue },
    ...trades.map((trade) => ({ time: countDaysBetween(startDay, trade.date) / days, amount: trade.side === "buy" ? -trade.amount : trade.amount })),
    { time: 1, amount: endValue },
  ];
  const periodReturn = solveRateOfReturn(flows);
  return periodReturn === null ? null : { period: periodReturn, annual: annualizeReturn(periodReturn, days) };
}

// Time-weighted return of a period, chained day by day where money moved:
//   valueOnDay(day)    what the investments were worth at the end of that day
//   trades             as above; on a trade day, buys count as arriving at the start of the day (they were worth
//                      what they cost before the day's prices moved them) and sells as leaving at its end:
//                          1 + r_day = (value at end of day + sold that day) / (value at end of day before + bought that day)
// Between trade days nothing comes in or out, so their daily returns chain into end value ÷ start value: only the
// trade days and the days before them are needed. Days with nothing held are skipped. Returns { period, annual } or null.
function calculateTimeWeightedReturn({ startDay, endDay, valueOnDay, trades, addDays }) {
  const days = countDaysBetween(startDay, endDay);
  if (days <= 0) return null;
  const moneyByDay = new Map(); // day -> { bought, sold }
  for (const trade of trades) {
    const dayTotals = moneyByDay.get(trade.date) ?? { bought: 0, sold: 0 };
    dayTotals[trade.side === "buy" ? "bought" : "sold"] += trade.amount;
    moneyByDay.set(trade.date, dayTotals);
  }

  let growth = 1, anythingHeld = false, previousDay = startDay;
  for (const tradeDay of [...moneyByDay.keys()].sort()) {
    const dayBefore = addDays(tradeDay, -1);
    if (dayBefore > previousDay) growth *= chainWithoutFlows(valueOnDay(previousDay), valueOnDay(dayBefore));
    const { bought, sold } = moneyByDay.get(tradeDay);
    const valueAtStart = valueOnDay(dayBefore) + bought;
    if (valueAtStart > 0) {
      growth *= (valueOnDay(tradeDay) + sold) / valueAtStart;
      anythingHeld = true;
    }
    previousDay = tradeDay;
  }
  if (endDay > previousDay) growth *= chainWithoutFlows(valueOnDay(previousDay), valueOnDay(endDay));
  if (valueOnDay(startDay) > 0) anythingHeld = true;
  if (!anythingHeld) return null;
  const periodReturn = growth - 1;
  return { period: periodReturn, annual: annualizeReturn(periodReturn, days) };

  // A stretch with no money in or out: its return is simply end ÷ start (1 when nothing was held)
  function chainWithoutFlows(startValue, endValue) {
    return startValue > 0 ? endValue / startValue : 1;
  }
}

module.exports = { calculateXirr, solveRateOfReturn, annualizeReturn, calculateMoneyWeightedReturn, calculateTimeWeightedReturn, countDaysBetween };
