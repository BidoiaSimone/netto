/* FAKE MARKET DATA: stands in for backend/server/services/yahooFinanceMarketData.js during the tests
 * (testEnvironment.js swaps it in). Same two functions, same shapes, but the prices are made up and fixed:
 * the tests must give the same answer every time, offline, whatever the market did today.
 *
 *   current price   a fixed number per ticker
 *   price history   one close per day (or per week), a smooth wave around a base price, so values
 *                   really change from one day to the next and the investment results aren't all 0
 *
 * A ticker not listed here behaves like one Yahoo doesn't know: both functions throw.
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

module.exports = { getCurrentPriceInEuros, getPriceHistoryInEuros, FAKE_CURRENT_PRICE_BY_TICKER };
