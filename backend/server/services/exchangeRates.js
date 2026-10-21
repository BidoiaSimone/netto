/* MARKET EXCHANGE RATES for foreign-currency transactions (migration 14)
 *
 * Three jobs:
 *   getMarketExchangeRate      the rate on a day, cached, with a time limit: the transaction dialog asks for it to
 *                              prefill the euros, and saving a transaction asks again to store it
 *   fillMissingMarketRates     a transaction saved while Yahoo couldn't be reached (offline on a trip), or added by
 *                              a recurring rule (which can't wait for the internet), has no rate yet: this fills
 *                              them in later. It runs at startup, after recurring transactions are added, and after
 *                              a save that couldn't get its rate.
 *   lookUpMarketRateOrNull     what saving uses: a rate, or null rather than an error (the euros are the truth;
 *                              a missing rate only means the exchange cost can't be shown yet)
 */

const db = require("../../db/databaseConnection.js");
const { getExchangeRateOnDate } = require("./yahooFinanceMarketData.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");

const LOOKUP_TIME_LIMIT_MILLISECONDS = 4000;           // saving a transaction never waits longer than this for Yahoo
const TODAYS_RATE_CACHE_MILLISECONDS = 15 * 60 * 1000; // today's rate still moves; a past day's never does
const MAXIMUM_TRANSACTIONS_FILLED_PER_RUN = 300;

// "JPY 2026-10-14" -> { promise, savedAt }. The promise itself is cached, so two requests for the same rate
// at the same moment share one download. A failed lookup is forgotten, so the next request tries again.
const rateCache = new Map();

function rejectAfter(milliseconds) {
  return new Promise((resolve, reject) => setTimeout(() => reject(new Error("the exchange rate took too long to arrive")), milliseconds).unref());
}

// { unitsPerEuro, rateDate } for `currency` on `date`; throws when Yahoo can't be reached or has no rate
async function getMarketExchangeRate(currency, date) {
  const cacheKey = `${currency} ${date}`;
  const cachedEntry = rateCache.get(cacheKey);
  const isFresh = cachedEntry && (date < getTodayAsLocalDate() || Date.now() - cachedEntry.savedAt < TODAYS_RATE_CACHE_MILLISECONDS);
  if (!isFresh) {
    const promise = getExchangeRateOnDate(currency, date);
    rateCache.set(cacheKey, { promise, savedAt: Date.now() });
    promise.catch(() => { if (rateCache.get(cacheKey)?.promise === promise) rateCache.delete(cacheKey); });
  }
  return Promise.race([rateCache.get(cacheKey).promise, rejectAfter(LOOKUP_TIME_LIMIT_MILLISECONDS)]);
}

async function lookUpMarketRateOrNull(currency, date) {
  if (!currency) return null;
  try {
    return (await getMarketExchangeRate(currency, date)).unitsPerEuro;
  } catch {
    return null;
  }
}

const selectTransactionsWithoutRate = db.prepare(`
  SELECT id, original_currency, date FROM transactions
  WHERE original_currency IS NOT NULL AND original_market_rate IS NULL
  ORDER BY date DESC LIMIT ${MAXIMUM_TRANSACTIONS_FILLED_PER_RUN}
`);
// Only while still empty and still that currency: an edit made meanwhile wins
const storeMarketRate = db.prepare(`UPDATE transactions SET original_market_rate = ? WHERE id = ? AND original_market_rate IS NULL AND original_currency = ?`);

let fillIsRunning = false;

// Fills in the rate of every foreign-currency transaction that has none. Returns how many were filled.
// Each currency + date is looked up once, and a day Yahoo can't answer for is simply left for next time.
async function fillMissingMarketRates() {
  if (fillIsRunning) return 0;
  fillIsRunning = true;
  try {
    let filledCount = 0;
    for (const transaction of selectTransactionsWithoutRate.all()) {
      const unitsPerEuro = await lookUpMarketRateOrNull(transaction.original_currency, transaction.date);
      if (unitsPerEuro) filledCount += storeMarketRate.run(unitsPerEuro, transaction.id, transaction.original_currency).changes;
    }
    if (filledCount) console.log(`Exchange rates: filled in for ${filledCount} transaction(s)`);
    return filledCount;
  } finally {
    fillIsRunning = false;
  }
}

// Fire and forget: never throws, never delays the caller
function fillMissingMarketRatesInBackground() {
  fillMissingMarketRates().catch((error) => console.error(`Exchange rates could not be filled in: ${error.message}`));
}

module.exports = { getMarketExchangeRate, lookUpMarketRateOrNull, fillMissingMarketRates, fillMissingMarketRatesInBackground };
