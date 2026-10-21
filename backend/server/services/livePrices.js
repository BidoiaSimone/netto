/* TODAY'S PRICE OF AN INVESTMENT, even when Yahoo doesn't give one right now
 * Every page that values the investments asks here (Home's net worth, the Investments page, the target allocation…):
 *   - the same ticker asked again within a minute gets the same answer, without asking Yahoo again: a page load asks
 *     for every holding several times at once, and Yahoo starts refusing when asked too much
 *   - a price that arrives is kept (table last_known_prices, migration 20)
 *   - when Yahoo has no price right now (weekend, slow, refusing), the last one kept is used, with when it was
 *     fetched, so the investment counts at its last value instead of 0
 * Only a ticker that never had a price at all fails.
 */

const db = require("../../db/databaseConnection.js");
const { getCurrentPriceInEuros } = require("./yahooFinanceMarketData.js");

const REUSE_FOR_MILLISECONDS = 60 * 1000;
const recentAnswers = new Map(); // ticker -> { at, promise }

const saveLastKnownPrice = db.prepare(`
  INSERT INTO last_known_prices (ticker, price_in_euros, fetched_at) VALUES (?, ?, ?)
  ON CONFLICT(ticker) DO UPDATE SET price_in_euros = excluded.price_in_euros, fetched_at = excluded.fetched_at`);
const selectLastKnownPrice = db.prepare(`SELECT price_in_euros, fetched_at FROM last_known_prices WHERE ticker = ?`);

async function askYahooOrRemember(ticker, exchangeRateCache) {
  try {
    const price = await getCurrentPriceInEuros(ticker, exchangeRateCache);
    saveLastKnownPrice.run(ticker, price, new Date().toISOString());
    return { price, as_of: null }; // live
  } catch (error) {
    const lastKnown = selectLastKnownPrice.get(ticker);
    if (!lastKnown) throw error;
    return { price: lastKnown.price_in_euros, as_of: lastKnown.fetched_at };
  }
}

// { price (euros, one share), as_of: null when live, else when the price used was fetched }. Throws only when
// there's neither a live price nor a kept one.
function getPriceInEurosOrLastKnown(ticker, exchangeRateCache = new Map()) {
  const recent = recentAnswers.get(ticker);
  if (recent && Date.now() - recent.at < REUSE_FOR_MILLISECONDS) return recent.promise;
  const promise = askYahooOrRemember(ticker, exchangeRateCache);
  recentAnswers.set(ticker, { at: Date.now(), promise });
  promise.catch(() => recentAnswers.delete(ticker)); // a failure isn't remembered: the next ask tries again
  return promise;
}

module.exports = { getPriceInEurosOrLastKnown };
