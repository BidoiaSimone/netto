/* LIVE MARKET DATA (Yahoo Finance), shared by the investments and analytics routes */

const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Multiplier turning 1 unit of `currency` into EUR.
// `cache` (a Map) lets one request reuse a rate instead of fetching it once per ticker.
function getRateToEur(currency, cache = new Map()) {
  if (currency === "EUR") return Promise.resolve(1);
  if (currency === "GBp") return getRateToEur("GBP", cache).then((r) => r / 100); // London quotes in pence

  if (!cache.has(currency)) {
    cache.set(
      currency,
      yahooFinance.quote(`${currency}EUR=X`).then((fx) => fx.regularMarketPrice)
    );
  }
  return cache.get(currency);
}

// Current price of one share/unit of `ticker`, in EUR. Throws if Yahoo has no price.
async function getPriceInEur(ticker, cache) {
  const quote = await yahooFinance.quote(ticker);
  if (!quote || quote.regularMarketPrice == null) {
    throw new Error(`No price available for ${ticker}`);
  }
  const rate = await getRateToEur(quote.currency, cache);
  return quote.regularMarketPrice * rate;
}

module.exports = { getPriceInEur };
