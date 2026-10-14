/* INVESTMENT HOLDINGS (Investments page): what you hold, its live value, and its price history.
 * A holding is never typed in: it is what its trades add up to (see services/holdingsCalculator.js).
 * Trades themselves are in investmentTradeRoutes.js.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { normalizeTicker, selectHoldingsStillHeld, convertHoldingRowForApi, addLiveMarketValue } = require("../services/holdingValuation.js");
const { getPriceHistoryOfAllHoldings } = require("../services/investmentPriceHistory.js");

const router = express.Router();

// Every holding still held, with live prices.
// allSettled so one bad ticker doesn't break the whole list: that holding gets a price_error instead.
router.get("/investments", async function listHoldingsWithLiveValue(request, response) {
  try {
    const holdings = selectHoldingsStillHeld().map(convertHoldingRowForApi);
    const exchangeRateCache = new Map();
    const valuations = await Promise.allSettled(holdings.map((holding) => addLiveMarketValue(holding, exchangeRateCache)));
    response.json(valuations.map((valuation, index) =>
      valuation.status === "fulfilled" ? valuation.value : { ...holdings[index], price_error: valuation.reason.message }));
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

// Price history of every holding (how each fund / index has moved), in EUR. ?range=1m|6m|1y|5y
// Declared before /investments/:ticker so "history" isn't read as a ticker.
router.get("/investments/history", async function getHoldingsPriceHistory(request, response) {
  try {
    response.json(await getPriceHistoryOfAllHoldings(request.query.range));
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

// Single holding, with its live value. Registered last (see apiRouter.js), so /investments/trades
// and /investments/history match first.
router.get("/investments/:ticker", async function getOneHolding(request, response) {
  try {
    const holdingRow = db.prepare(`SELECT * FROM investments WHERE ticker = ?`).get(normalizeTicker(request.params.ticker));
    if (!holdingRow) return response.status(404).json({ error: "Investment not found" });
    const holding = convertHoldingRowForApi(holdingRow);
    try {
      response.json(await addLiveMarketValue(holding, new Map()));
    } catch (priceError) {
      response.json({ ...holding, price_error: priceError.message }); // DB data is fine, only the live price failed
    }
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

module.exports = router;
