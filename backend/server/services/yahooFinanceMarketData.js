/* LIVE MARKET DATA (Yahoo Finance), shared by the investment and net worth routes.
 * Every price returned here is already converted to euros.
 */

const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// ---------- current prices ----------

// Multiplier turning 1 unit of `currency` into EUR.
// `exchangeRateCache` (a Map) lets one request reuse a rate instead of fetching it once per ticker.
function getExchangeRateToEuros(currency, exchangeRateCache = new Map()) {
  if (currency === "EUR") return Promise.resolve(1);
  if (currency === "GBp") return getExchangeRateToEuros("GBP", exchangeRateCache).then((rate) => rate / 100); // London quotes in pence

  if (!exchangeRateCache.has(currency)) {
    exchangeRateCache.set(
      currency,
      yahooFinance.quote(`${currency}EUR=X`).then((exchangeQuote) => exchangeQuote.regularMarketPrice)
    );
  }
  return exchangeRateCache.get(currency);
}

// Current price of one share/unit of `ticker`, in EUR. Throws if Yahoo has no price.
async function getCurrentPriceInEuros(ticker, exchangeRateCache) {
  const quote = await yahooFinance.quote(ticker);
  if (!quote || quote.regularMarketPrice == null) {
    throw new Error(`No price available for ${ticker}`);
  }
  const exchangeRate = await getExchangeRateToEuros(quote.currency, exchangeRateCache);
  return quote.regularMarketPrice * exchangeRate;
}

// ---------- price history ----------

const toDayKey = (date) => new Date(date).toISOString().slice(0, 10);

// Daily (or weekly) closes of `symbol` since `startDate`, as a Map "YYYY-MM-DD" -> close, plus its currency.
async function getClosingPrices(symbol, startDate, interval) {
  const chart = await yahooFinance.chart(symbol, { period1: startDate, interval });
  const closingPricesByDay = new Map();
  for (const quote of chart.quotes) if (quote.close != null) closingPricesByDay.set(toDayKey(quote.date), quote.close);
  return { currency: chart.meta.currency, closingPricesByDay };
}

// Historical rates turning 1 unit of `currency` into EUR, same shape as closingPricesByDay.
// `exchangeRateHistoryCache` (a Map) shares one download per currency across tickers.
function getExchangeRateHistory(currency, startDate, interval, exchangeRateHistoryCache) {
  if (currency === "EUR") return Promise.resolve(null); // null = always 1
  if (currency === "GBp") {
    return getExchangeRateHistory("GBP", startDate, interval, exchangeRateHistoryCache)
      .then((ratesByDay) => new Map([...ratesByDay].map(([day, rate]) => [day, rate / 100])));
  }
  if (!exchangeRateHistoryCache.has(currency)) {
    exchangeRateHistoryCache.set(currency, getClosingPrices(`${currency}EUR=X`, startDate, interval).then((result) => result.closingPricesByDay));
  }
  return exchangeRateHistoryCache.get(currency);
}

// History of one share of `ticker` in EUR: sorted [{ date, price }].
// A day without an FX quote uses the latest earlier rate (FX and stock calendars differ).
async function getPriceHistoryInEuros(ticker, startDate, interval, exchangeRateHistoryCache = new Map()) {
  const { currency, closingPricesByDay } = await getClosingPrices(ticker, startDate, interval);
  if (closingPricesByDay.size === 0) throw new Error(`No price history for ${ticker}`);
  const ratesByDay = await getExchangeRateHistory(currency, startDate, interval, exchangeRateHistoryCache);

  const rateDays = ratesByDay ? [...ratesByDay.keys()].sort() : [];
  let nextRateIndex = 0;
  let rateInEffect = ratesByDay ? ratesByDay.get(rateDays[0]) : 1;
  const historyInEuros = [];
  for (const day of [...closingPricesByDay.keys()].sort()) {
    while (ratesByDay && nextRateIndex < rateDays.length && rateDays[nextRateIndex] <= day) {
      rateInEffect = ratesByDay.get(rateDays[nextRateIndex++]);
    }
    historyInEuros.push({ date: day, price: closingPricesByDay.get(day) * rateInEffect });
  }
  return historyInEuros;
}

// ---------- exchange rate on a given day (foreign-currency transactions) ----------

// How many units of `currency` one euro bought on `date` (YYYY-MM-DD): EURJPY=X is "yen per euro", the way
// rates are usually quoted (and precise: JPYEUR=X would be 0.0062, with few significant digits left).
// Markets close at weekends and on holidays, so the rate is the last daily close on or before that date,
// looking back up to 10 days. Returns { unitsPerEuro, rateDate }. Throws when Yahoo has nothing.
async function getExchangeRateOnDate(currency, date) {
  const dayAfter = new Date(Date.parse(date + "T00:00:00Z") + 864e5);
  const tenDaysBefore = new Date(Date.parse(date + "T00:00:00Z") - 10 * 864e5);
  const chart = await yahooFinance.chart(`EUR${currency}=X`, { period1: tenDaysBefore, period2: dayAfter, interval: "1d" });
  const closesUpToDate = chart.quotes
    .filter((quote) => quote.close != null && quote.close > 0 && toDayKey(quote.date) <= date)
    .sort((first, second) => toDayKey(first.date).localeCompare(toDayKey(second.date)));
  const lastClose = closesUpToDate.at(-1);
  if (!lastClose) throw new Error(`No EUR/${currency} rate available around ${date}`);
  return { unitsPerEuro: lastClose.close, rateDate: toDayKey(lastClose.date) };
}

module.exports = { getCurrentPriceInEuros, getPriceHistoryInEuros, getExchangeRateOnDate };
