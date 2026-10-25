/* YAHOO FINANCE THROUGH NETTO'S PRICE PROXY: stands in for the "yahoo-finance2" package
 * A browser can't call Yahoo directly (it doesn't allow other sites: CORS), so the PWA asks a tiny Cloudflare Worker
 * (pwa/priceProxy/worker.js) that calls Yahoo and passes the answer back, storing nothing.
 * Same two methods backend/server/services/yahooFinanceMarketData.js uses, answering in the same shape:
 *   quote(symbol)                              -> { regularMarketPrice, currency }
 *   chart(symbol, { period1, period2, interval }) -> { meta: { currency }, quotes: [{ date, close }] }
 * The proxy's address comes from NETTO_PRICE_PROXY_URL when the PWA is built (pwa/build.mjs).
 */

const PRICE_PROXY_URL = typeof NETTO_PRICE_PROXY_URL === "string" ? NETTO_PRICE_PROXY_URL : "";

const toUnixSeconds = (date) => Math.floor(new Date(date).getTime() / 1000);

async function askPriceProxy(path, parameters) {
  if (!PRICE_PROXY_URL) throw new Error("No price proxy configured (build with NETTO_PRICE_PROXY_URL)");
  const url = new URL(path, PRICE_PROXY_URL);
  for (const [name, value] of Object.entries(parameters)) if (value != null) url.searchParams.set(name, value);
  const response = await fetch(url);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data && data.error) || `Price proxy answered ${response.status}`);
  return data;
}

class YahooFinance {
  quote(symbol) {
    return askPriceProxy("quote", { symbol });
  }

  async chart(symbol, { period1, period2, interval = "1d" }) {
    const chart = await askPriceProxy("chart", { symbol, interval, period1: toUnixSeconds(period1), period2: period2 && toUnixSeconds(period2) });
    return { meta: chart.meta, quotes: chart.quotes.map((quote) => ({ date: new Date(quote.date), close: quote.close })) };
  }
}

module.exports = { default: YahooFinance };
