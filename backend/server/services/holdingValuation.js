/* HOLDINGS AS THE API SHOWS THEM
 * Turns rows of the `investments` table (cents) into what the frontend receives (euros),
 * optionally with their live market value.
 */

const db = require("../../db/databaseConnection.js");
const { getCurrentPriceInEuros } = require("./yahooFinanceMarketData.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

// "  vwce.mi " -> "VWCE.MI"; anything that isn't text -> ""
const normalizeTicker = (ticker) => (typeof ticker === "string" ? ticker.trim().toUpperCase() : "");

const selectHoldingsStillHeld = () => db.prepare(`SELECT * FROM investments WHERE shares > 0 ORDER BY ticker`).all();

// DB row (cents) -> API (euros). The average price is worked out, not stored.
const convertHoldingRowForApi = (holdingRow) => ({
  ticker: holdingRow.ticker,
  shares: holdingRow.shares,
  amount_invested: convertCentsToEuros(holdingRow.amount_invested),
  average_purchase_price: holdingRow.shares > 0 ? holdingRow.amount_invested / 100 / holdingRow.shares : 0,
  realized_gain: convertCentsToEuros(holdingRow.realized_gain),
});

// Adds live market data to a holding already converted for the API. All money values are in EUR.
async function addLiveMarketValue(holding, exchangeRateCache) {
  const currentPrice = await getCurrentPriceInEuros(holding.ticker, exchangeRateCache);
  const currentValue = currentPrice * holding.shares;
  const gain = currentValue - holding.amount_invested;
  return {
    ...holding,
    current_price: currentPrice,
    current_value: currentValue,
    gain,
    gain_pct: holding.amount_invested > 0 ? (gain / holding.amount_invested) * 100 : null,
  };
}

module.exports = { normalizeTicker, selectHoldingsStillHeld, convertHoldingRowForApi, addLiveMarketValue };
