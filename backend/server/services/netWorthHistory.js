/* NET WORTH OVER TIME (Insights page chart)
 * Nothing is stored per day: the history is rebuilt from what the database already knows.
 *
 *   accounts     = every account's opening balance (from the day it starts) + money in − money out,
 *                  summed over all transactions dated up to that day. Movements between your own
 *                  accounts cancel out; a reconciliation counts on its day, like any transaction.
 *   investments  = shares held that day (from the trades) × that day's closing price in EUR.
 *                  The last point uses the live price instead, so it matches the net worth on Home.
 *                  A ticker without price history is valued at what it cost (and reported in failed_tickers).
 *
 * An account "starts" on its open date, or on its first transaction if that is earlier
 * (transactions can be back-dated before the account was added to the app).
 */

const db = require("../../db/databaseConnection.js");
const { findFirstRecordedDate } = require("../../db/firstRecordedDate.js");
const { getCurrentPriceInEuros, getPriceHistoryInEuros } = require("./yahooFinanceMarketData.js");
const { replayTrades } = require("./holdingsCalculator.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");

const NET_WORTH_HISTORY_RANGES = {
  "1m": { days: 31 },
  "6m": { days: 183 },
  "1y": { days: 366 },
  "all": { days: null }, // from the first day anything was recorded
};
const DEFAULT_NET_WORTH_HISTORY_RANGE = "1y";
const LONGEST_DAILY_SPAN_IN_DAYS = 400; // longer periods get one point per week
const PRICE_HISTORY_CACHE_LIFETIME_MILLISECONDS = 15 * 60 * 1000;
const MILLISECONDS_PER_DAY = 864e5;

const priceHistoryCache = new Map(); // "ticker|startDay|interval" -> { savedAt, pricesByDay | error }

// ---------- dates ----------

// "2026-10-14" <-> a UTC Date at midnight: day arithmetic without time zone surprises
const parseDay = (day) => new Date(day + "T00:00:00Z");
const formatDay = (date) => date.toISOString().slice(0, 10);
const addDays = (day, numberOfDays) => formatDay(new Date(parseDay(day).getTime() + numberOfDays * MILLISECONDS_PER_DAY));
const countDaysBetween = (firstDay, lastDay) => Math.round((parseDay(lastDay) - parseDay(firstDay)) / MILLISECONDS_PER_DAY);

// The days the chart has a point for: every day, or every 7th day for long periods. Always ends today.
function listChartDays(firstDay, lastDay) {
  const spanInDays = countDaysBetween(firstDay, lastDay);
  const stepInDays = spanInDays > LONGEST_DAILY_SPAN_IN_DAYS ? 7 : 1;
  const chartDays = [];
  for (let offset = spanInDays % stepInDays; offset <= spanInDays; offset += stepInDays) chartDays.push(addDays(firstDay, offset));
  if (chartDays[0] !== firstDay) chartDays.unshift(firstDay);
  return chartDays;
}

function resolveFirstChartDay(range, today) {
  const firstRecordedDay = findFirstRecordedDate(db);
  const { days } = NET_WORTH_HISTORY_RANGES[range];
  if (days === null) return firstRecordedDay;
  const rangeStart = addDays(today, -(days - 1));
  return rangeStart > firstRecordedDay ? rangeStart : firstRecordedDay; // nothing to show before the first record
}

// ---------- accounts ----------

// Every change to the accounts' total, as { day, amountInCents }, in no particular order
function listAccountsTotalChanges() {
  const openingBalances = db.prepare(`
    SELECT MIN(a.open_date, COALESCE((SELECT MIN(date) FROM transactions WHERE from_account_id = a.id OR to_account_id = a.id), a.open_date)) AS day,
           a.opening_balance AS amountInCents
    FROM accounts a WHERE a.opening_balance <> 0
  `).all();
  // money in counts +, money out −; a movement between two accounts adds up to 0
  const transactionEffects = db.prepare(`
    SELECT date AS day,
           (CASE WHEN to_account_id IS NOT NULL THEN amount ELSE 0 END)
         - (CASE WHEN from_account_id IS NOT NULL THEN amount ELSE 0 END) AS amountInCents
    FROM transactions
  `).all();
  return [...openingBalances, ...transactionEffects];
}

// The accounts' total at the end of each chart day, in cents
function calculateAccountsTotalPerDay(chartDays) {
  const changesInDateOrder = listAccountsTotalChanges().sort((first, second) => (first.day < second.day ? -1 : first.day > second.day ? 1 : 0));
  const totals = [];
  let runningTotal = 0, nextChangeIndex = 0;
  for (const day of chartDays) {
    while (nextChangeIndex < changesInDateOrder.length && changesInDateOrder[nextChangeIndex].day <= day) {
      runningTotal += changesInDateOrder[nextChangeIndex++].amountInCents;
    }
    totals.push(runningTotal);
  }
  return totals;
}

// ---------- investments ----------

// Daily (or weekly) EUR closes of a ticker since startDay, as a Map day -> price. Cached for a few minutes.
async function getCachedPriceHistory(ticker, startDay, interval) {
  const cacheKey = `${ticker}|${startDay}|${interval}`;
  const cached = priceHistoryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < PRICE_HISTORY_CACHE_LIFETIME_MILLISECONDS) {
    if (cached.error) throw cached.error;
    return cached.pricesByDay;
  }
  try {
    const history = await getPriceHistoryInEuros(ticker, parseDay(startDay), interval);
    const pricesByDay = new Map(history.map((point) => [point.date, point.price]));
    priceHistoryCache.set(cacheKey, { savedAt: Date.now(), pricesByDay });
    return pricesByDay;
  } catch (error) {
    priceHistoryCache.set(cacheKey, { savedAt: Date.now(), error }); // don't ask Yahoo again on every refresh
    throw error;
  }
}

// For each chart day, the latest known price on or before it (markets are closed on weekends and holidays).
// Before the first known price, the first one is used. null when there are no prices at all.
function findPriceOnEachDay(pricesByDay, chartDays) {
  const priceDays = [...pricesByDay.keys()].sort();
  if (!priceDays.length) return null;
  const prices = [];
  let nextPriceIndex = 0, priceInEffect = pricesByDay.get(priceDays[0]);
  for (const day of chartDays) {
    while (nextPriceIndex < priceDays.length && priceDays[nextPriceIndex] <= day) priceInEffect = pricesByDay.get(priceDays[nextPriceIndex++]);
    prices.push(priceInEffect);
  }
  return prices;
}

// One ticker's value (cents) on each chart day. Returns { valuesInCents, hasMarketPrices }.
async function calculateTickerValuePerDay(ticker, tradesOfTicker, chartDays, interval, exchangeRateCache) {
  // shares held and their cost at the end of each day, by replaying the trades dated up to it
  const holdingOnEachDay = chartDays.map((day) => {
    const tradesUpToDay = tradesOfTicker.filter((trade) => trade.date <= day);
    const replayResult = tradesUpToDay.length ? replayTrades(tradesUpToDay) : { shares: 0, cost: 0 };
    return replayResult.error ? { shares: 0, cost: 0 } : replayResult;
  });
  if (holdingOnEachDay.every((holding) => holding.shares === 0)) return { valuesInCents: chartDays.map(() => 0), hasMarketPrices: true };

  let pricesOnEachDay = null;
  try {
    // start a week early, so the first chart day has a close even if it falls on a weekend
    pricesOnEachDay = findPriceOnEachDay(await getCachedPriceHistory(ticker, addDays(chartDays[0], -7), interval), chartDays);
  } catch {
    pricesOnEachDay = null;
  }
  if (!pricesOnEachDay) {
    return { valuesInCents: holdingOnEachDay.map((holding) => holding.cost), hasMarketPrices: false };
  }
  // today: the live price, like the net worth on Home (the history's last close can be a day old).
  // Only when the last day IS today: the Statements page also asks for days in the past.
  if (chartDays[chartDays.length - 1] === getTodayAsLocalDate()) {
    try {
      pricesOnEachDay[pricesOnEachDay.length - 1] = await getCurrentPriceInEuros(ticker, exchangeRateCache);
    } catch {
      // keep the last close
    }
  }
  return {
    valuesInCents: holdingOnEachDay.map((holding, index) => Math.round(holding.shares * pricesOnEachDay[index] * 100)),
    hasMarketPrices: true,
  };
}

// The investments' total value on each chart day (cents), each ticker's own values (tickerResults:
// [{ ticker, valuesInCents }]) and the tickers valued at cost instead. chartDays must be in date order.
async function calculateInvestmentsValuePerDay(chartDays) {
  const tradesByTicker = new Map();
  for (const trade of db.prepare(`SELECT * FROM investment_trades WHERE date <= ?`).all(chartDays[chartDays.length - 1])) {
    if (!tradesByTicker.has(trade.ticker)) tradesByTicker.set(trade.ticker, []);
    tradesByTicker.get(trade.ticker).push(trade);
  }
  const interval = countDaysBetween(chartDays[0], chartDays[chartDays.length - 1]) > LONGEST_DAILY_SPAN_IN_DAYS ? "1wk" : "1d";
  const exchangeRateCache = new Map();
  const tickerResults = await Promise.all([...tradesByTicker].map(async ([ticker, trades]) =>
    ({ ticker, ...(await calculateTickerValuePerDay(ticker, trades, chartDays, interval, exchangeRateCache)) })));

  const totals = chartDays.map((day, index) => tickerResults.reduce((sum, result) => sum + result.valuesInCents[index], 0));
  const tickersValuedAtCost = tickerResults.filter((result) => !result.hasMarketPrices).map((result) => result.ticker);
  return { totals, tickerResults, tickersValuedAtCost };
}

// ---------- everything together ----------

// { range, dates, accounts, investments, net_worth, failed_tickers } — money in euros, one value per date
async function getNetWorthHistory(requestedRange) {
  const range = NET_WORTH_HISTORY_RANGES[requestedRange] ? requestedRange : DEFAULT_NET_WORTH_HISTORY_RANGE;
  const today = getTodayAsLocalDate();
  const chartDays = listChartDays(resolveFirstChartDay(range, today), today);

  const accountsTotals = calculateAccountsTotalPerDay(chartDays);
  const { totals: investmentsTotals, tickersValuedAtCost } = await calculateInvestmentsValuePerDay(chartDays);

  const toEuros = (cents) => cents / 100;
  return {
    range,
    dates: chartDays,
    accounts: accountsTotals.map(toEuros),
    investments: investmentsTotals.map(toEuros),
    net_worth: chartDays.map((day, index) => toEuros(accountsTotals[index] + investmentsTotals[index])),
    failed_tickers: tickersValuedAtCost, // valued at what they cost, not at market price
  };
}

module.exports = { getNetWorthHistory, listChartDays, calculateInvestmentsValuePerDay, addDays };
