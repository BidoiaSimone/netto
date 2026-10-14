/* PRICE HISTORY OF EVERY HOLDING (Investments page chart)
 * How each fund / index has moved over a period, in EUR. Downloading it is slow (one request per
 * ticker), so a result is kept for a few minutes and reused while the holdings don't change.
 */

const { getPriceHistoryInEuros } = require("./yahooFinanceMarketData.js");
const { selectHoldingsStillHeld, convertHoldingRowForApi } = require("./holdingValuation.js");

const HISTORY_RANGES = {
  "1m": { days: 31, interval: "1d" },
  "6m": { days: 183, interval: "1d" },
  "1y": { days: 366, interval: "1d" },
  "5y": { days: 1827, interval: "1wk" },
};
const DEFAULT_HISTORY_RANGE = "1y";
const HISTORY_CACHE_LIFETIME_MILLISECONDS = 15 * 60 * 1000;
const MILLISECONDS_PER_DAY = 864e5;

const historyCache = new Map(); // "range|holdings" -> { savedAt, data }

const resolveHistoryRange = (requestedRange) => (HISTORY_RANGES[requestedRange] ? requestedRange : DEFAULT_HISTORY_RANGE);

// One holding's history, summarised for the chart
function summarizeHoldingHistory(holding, priceHistory) {
  const firstPoint = priceHistory[0], lastPoint = priceHistory[priceHistory.length - 1];
  return {
    ticker: holding.ticker,
    average_purchase_price: holding.average_purchase_price,
    dates: priceHistory.map((point) => point.date),
    prices: priceHistory.map((point) => point.price),
    change_pct: ((lastPoint.price - firstPoint.price) / firstPoint.price) * 100,
    change: (lastPoint.price - firstPoint.price) * holding.shares, // what that move meant for your shares
  };
}

// { range, holdings: [summary per ticker], failed_tickers: [tickers without history] }
async function getPriceHistoryOfAllHoldings(requestedRange) {
  const range = resolveHistoryRange(requestedRange);
  const holdings = selectHoldingsStillHeld().map(convertHoldingRowForApi);
  const cacheKey = range + "|" + JSON.stringify(holdings);
  const cachedResult = historyCache.get(cacheKey);
  if (cachedResult && Date.now() - cachedResult.savedAt < HISTORY_CACHE_LIFETIME_MILLISECONDS) return cachedResult.data;

  const { days, interval } = HISTORY_RANGES[range];
  const startDate = new Date(Date.now() - days * MILLISECONDS_PER_DAY);
  const exchangeRateHistoryCache = new Map();
  const downloads = await Promise.allSettled(holdings.map((holding) => getPriceHistoryInEuros(holding.ticker, startDate, interval, exchangeRateHistoryCache)));

  const holdingsWithHistory = [], failedTickers = [];
  downloads.forEach((download, index) => {
    if (download.status === "fulfilled" && download.value.length) holdingsWithHistory.push({ holding: holdings[index], priceHistory: download.value });
    else failedTickers.push(holdings[index].ticker);
  });

  const data = {
    range,
    holdings: holdingsWithHistory.map(({ holding, priceHistory }) => summarizeHoldingHistory(holding, priceHistory)),
    failed_tickers: failedTickers,
  };
  historyCache.set(cacheKey, { savedAt: Date.now(), data });
  return data;
}

module.exports = { getPriceHistoryOfAllHoldings };
