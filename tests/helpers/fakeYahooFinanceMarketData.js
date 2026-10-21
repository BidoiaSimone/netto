/* FAKE MARKET DATA: stands in for backend/server/services/yahooFinanceMarketData.js during the tests
 * (testEnvironment.js swaps it in). Same two functions, same shapes, but the prices are made up and fixed:
 * the tests must give the same answer every time, offline, whatever the market did today.
 *
 *   current price   a fixed number per ticker
 *   price history   one close per day (or per week), a smooth wave around a base price, so values
 *                   really change from one day to the next and the investment results aren't all 0
 *
 *   exchange rates  a fixed rate per currency, the same every day (units per 1 €)
 *
 * A ticker or currency not listed here behaves like one Yahoo doesn't know: the functions throw.
 * setFakeExchangeRatesReachable(false) makes every exchange rate fail, like being offline.
 */

const MILLISECONDS_PER_DAY = 864e5;

// In EUR already: the real module converts other currencies, the fake has nothing to convert
const FAKE_CURRENT_PRICE_BY_TICKER = {
  "VWCE.MI": 123.45,
  "AAPL": 201.37,
};

// "YYYY-MM-DD" in local time, like getTodayAsLocalDate in backend/server/utils/localDates.js
const getTodayAsLocalDate = () => new Date().toLocaleDateString("sv-SE");

// The made-up close of `ticker` on `day`: deterministic, with cents that aren't round on purpose
function calculateFakeClosingPrice(ticker, day) {
  const dayNumber = Math.round(Date.parse(day + "T00:00:00Z") / MILLISECONDS_PER_DAY);
  const wave = Math.sin(dayNumber / 17) * 0.08 + Math.cos(dayNumber / 5) * 0.02; // between -10% and +10%
  return Math.round(FAKE_CURRENT_PRICE_BY_TICKER[ticker] * (1 + wave) * 100) / 100;
}

async function getCurrentPriceInEuros(ticker) {
  if (!(ticker in FAKE_CURRENT_PRICE_BY_TICKER)) throw new Error(`No price available for ${ticker}`);
  return FAKE_CURRENT_PRICE_BY_TICKER[ticker];
}

// Same contract as the real one: sorted [{ date, price }] from startDate (a Date) to today
async function getPriceHistoryInEuros(ticker, startDate, interval) {
  if (!(ticker in FAKE_CURRENT_PRICE_BY_TICKER)) throw new Error(`No price history for ${ticker}`);
  const stepInDays = interval === "1wk" ? 7 : 1;
  const today = getTodayAsLocalDate();
  const history = [];
  for (let time = startDate.getTime(); ; time += stepInDays * MILLISECONDS_PER_DAY) {
    const day = new Date(time).toISOString().slice(0, 10);
    if (day > today) break;
    history.push({ date: day, price: calculateFakeClosingPrice(ticker, day) });
  }
  return history;
}

// Units of the currency per 1 €. KWD has 3 decimals, JPY none: both are used by the currency tests.
const FAKE_UNITS_PER_EURO_BY_CURRENCY = {
  JPY: 160,
  USD: 1.25,
  KWD: 0.3125,
  GBP: 0.8,
};
let exchangeRatesAreReachable = true;
const setFakeExchangeRatesReachable = (isReachable) => { exchangeRatesAreReachable = isReachable; };

// Same contract as the real one: { unitsPerEuro, rateDate }. A weekend date gives the Friday before, like the markets.
async function getExchangeRateOnDate(currency, date) {
  if (!exchangeRatesAreReachable) throw new Error("fetch failed");
  if (!(currency in FAKE_UNITS_PER_EURO_BY_CURRENCY)) throw new Error(`No EUR/${currency} rate available around ${date}`);
  const day = new Date(date + "T00:00:00Z");
  const daysBackToFriday = { 0: 2, 6: 1 }[day.getUTCDay()] ?? 0;
  const rateDate = new Date(day.getTime() - daysBackToFriday * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
  return { unitsPerEuro: FAKE_UNITS_PER_EURO_BY_CURRENCY[currency], rateDate };
}

module.exports = {
  getCurrentPriceInEuros, getPriceHistoryInEuros, getExchangeRateOnDate,
  FAKE_CURRENT_PRICE_BY_TICKER, FAKE_UNITS_PER_EURO_BY_CURRENCY, setFakeExchangeRatesReachable,
};
