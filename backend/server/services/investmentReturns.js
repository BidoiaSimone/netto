/* THE REAL RETURN OF THE INVESTMENTS IN A PERIOD (Statements page), per ticker and in total
 *
 * For a period from `from` to `to` (opening values at the end of the day before, like the balance sheet):
 *   money-weighted (XIRR)  the start value counts as money put in on the opening day, every buy as money in and
 *                          every sell as money out on its date (fees included in both), the end value as money
 *                          taken out on the last day
 *   time-weighted          the investments' own performance, chained at every day money moved
 * See services/rateOfReturn.js for the maths. Values on each day come from the same place as the balance sheet
 * (netWorthHistory.js: shares held that day × that day's closing price), so the start and end match it exactly.
 */

const db = require("../../db/databaseConnection.js");
const { addDays } = require("./netWorthHistory.js");
const { calculateMoneyWeightedReturn, calculateTimeWeightedReturn, countDaysBetween } = require("./rateOfReturn.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

// The days whose investment values the returns need: the period's two ends, plus every trade day and the day before it
function listDaysNeededForReturns(openingDay, to) {
  const days = new Set([openingDay, to]);
  for (const { date } of db.prepare(`SELECT DISTINCT date FROM investment_trades WHERE date > ? AND date <= ?`).all(openingDay, to)) {
    days.add(date);
    days.add(addDays(date, -1));
  }
  return [...days].sort();
}

// One set of returns (a ticker, or everything): values in cents by day, trades [{ date, side, amount }] in cents
function buildReturns({ openingDay, to, valueOnDay, trades }) {
  const startValue = valueOnDay(openingDay), endValue = valueOnDay(to);
  const bought = trades.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + trade.amount, 0);
  const sold = trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + trade.amount, 0);
  return {
    opening: convertCentsToEuros(startValue),
    closing: convertCentsToEuros(endValue),
    bought: convertCentsToEuros(bought),
    sold: convertCentsToEuros(sold),
    gain: convertCentsToEuros(endValue - startValue - bought + sold), // the same as the bridge's "Investment results"
    money_weighted: calculateMoneyWeightedReturn({ startDay: openingDay, endDay: to, startValue, trades, endValue }),
    time_weighted: calculateTimeWeightedReturn({ startDay: openingDay, endDay: to, valueOnDay, trades, addDays }),
  };
}

// valuation: from calculateInvestmentsValuePerDay(days) for days = listDaysNeededForReturns(openingDay, to).
// Returns { days, tickers: [...], total } with returns as fractions (0.05 = 5%), money in euros.
function buildInvestmentReturns({ openingDay, to, days, valuation }) {
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const tradesInPeriod = db.prepare(`SELECT ticker, date, side, amount FROM investment_trades WHERE date > ? AND date <= ? ORDER BY date, id`).all(openingDay, to);

  const tickers = valuation.tickerResults
    .map((result) => ({
      ticker: result.ticker,
      valued_at_cost: !result.hasMarketPrices, // no price history: its "return" is 0 by construction
      ...buildReturns({
        openingDay, to,
        valueOnDay: (day) => result.valuesInCents[dayIndex.get(day)],
        trades: tradesInPeriod.filter((trade) => trade.ticker === result.ticker),
      }),
    }))
    // tickers with nothing at either end and no trades in the period have nothing to say
    .filter((tickerReturns) => tickerReturns.opening || tickerReturns.closing || tickerReturns.bought || tickerReturns.sold)
    .sort((first, second) => first.ticker.localeCompare(second.ticker));

  const total = buildReturns({ openingDay, to, valueOnDay: (day) => valuation.totals[dayIndex.get(day)], trades: tradesInPeriod });
  return { days: countDaysBetween(openingDay, to), tickers, total };
}

module.exports = { listDaysNeededForReturns, buildInvestmentReturns };
