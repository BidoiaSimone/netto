/* TARGET ALLOCATION (Investments page, migration 15)
 *   GET /investments/targets                 [{ ticker, target_percent }]
 *   PUT /investments/targets                 { targets: [{ ticker, target_percent }] }: the whole list, adding up to 100%
 *                                            (an empty list removes every target)
 *   GET /investments/allocation?new_money=   each ticker's share now, its target and its drift, at live prices;
 *                                            with new_money (euros), how to split it without selling
 * The maths is in services/targetAllocation.js. Registered before investmentHoldingRoutes.js, so "targets" and
 * "allocation" aren't read as tickers by /investments/:ticker.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { convertEurosToCents, convertCentsToEuros } = require("../utils/moneyConversion.js");
const { normalizeTicker, selectHoldingsStillHeld, convertHoldingRowForApi, addLiveMarketValue } = require("../services/holdingValuation.js");
const { getPriceInEurosOrLastKnown } = require("../services/livePrices.js");
const { findUnknownTickerError } = require("../validation/tradeValidation.js");
const { BASIS_POINTS_IN_ONE, describeAllocation, splitNewMoneyWithoutSelling } = require("../services/targetAllocation.js");
const { readSetting } = require("../services/appSettings.js");

const router = express.Router();

const selectTargets = db.prepare(`SELECT ticker, target_basis_points FROM investment_targets ORDER BY target_basis_points DESC, ticker`);
const readTargetBasisPointsByTicker = () => new Map(selectTargets.all().map((row) => [row.ticker, row.target_basis_points]));

// 70 -> 7000; 12.345 -> 1235 (two decimals of a percent is plenty)
const convertPercentToBasisPoints = (percent) => Math.round(Number((Number(percent) * 100).toPrecision(15)));

router.get("/investments/targets", function listTargets(request, response) {
  response.json(selectTargets.all().map((row) => ({ ticker: row.ticker, target_percent: row.target_basis_points / 100 })));
});

router.put("/investments/targets", async function replaceTargets(request, response) {
  const sentTargets = request.body?.targets;
  if (!Array.isArray(sentTargets)) return response.status(400).json({ error: "targets must be a list of { ticker, target_percent }" });

  const basisPointsByTicker = new Map();
  for (const sentTarget of sentTargets) {
    const ticker = normalizeTicker(sentTarget?.ticker);
    if (!ticker) return response.status(400).json({ error: "every target needs a ticker" });
    if (basisPointsByTicker.has(ticker)) return response.status(400).json({ error: `${ticker} is in the list twice` });
    const basisPoints = convertPercentToBasisPoints(sentTarget.target_percent);
    if (!Number.isFinite(basisPoints) || basisPoints < 0 || basisPoints > BASIS_POINTS_IN_ONE) return response.status(400).json({ error: `${ticker}: the target must be between 0 and 100%` });
    if (basisPoints > 0) basisPointsByTicker.set(ticker, basisPoints); // 0% = no target: no row
  }
  const totalBasisPoints = [...basisPointsByTicker.values()].reduce((sum, basisPoints) => sum + basisPoints, 0);
  if (basisPointsByTicker.size && totalBasisPoints !== BASIS_POINTS_IN_ONE) {
    return response.status(400).json({ error: `the targets add up to ${(totalBasisPoints / 100).toLocaleString("it-IT")}%: they must make exactly 100%` });
  }
  for (const ticker of basisPointsByTicker.keys()) {
    const unknownTickerError = await findUnknownTickerError(ticker); // a typo'd ticker would be a target nobody can buy
    if (unknownTickerError) return response.status(400).json({ error: unknownTickerError });
  }

  db.transaction(() => {
    db.prepare(`DELETE FROM investment_targets`).run();
    const insertTarget = db.prepare(`INSERT INTO investment_targets (ticker, target_basis_points) VALUES (?, ?)`);
    for (const [ticker, basisPoints] of basisPointsByTicker) insertTarget.run(ticker, basisPoints);
  })();
  response.json(selectTargets.all().map((row) => ({ ticker: row.ticker, target_percent: row.target_basis_points / 100 })));
});

// Live value of every holding. A holding whose price can't be fetched has no value, and is listed in missing_prices:
// the shares and the split are then left out (they would be wrong), the targets themselves are still shown.
async function valueHoldingsAtLivePrices() {
  const exchangeRateCache = new Map();
  const holdings = selectHoldingsStillHeld().map(convertHoldingRowForApi);
  const valuations = await Promise.allSettled(holdings.map((holding) => addLiveMarketValue(holding, exchangeRateCache)));
  const valued = [], missingPrices = [];
  valuations.forEach((valuation, index) => {
    if (valuation.status === "fulfilled") valued.push(valuation.value);
    else missingPrices.push(holdings[index].ticker);
  });
  return { valued, missingPrices, exchangeRateCache };
}

// The price of each ticker that gets money (for "≈ 3,4 shares"): from the holdings, or asked for a ticker not held yet
async function findPricesOfTickers(tickers, valuedHoldings, exchangeRateCache) {
  const priceByTicker = new Map(valuedHoldings.map((holding) => [holding.ticker, holding.current_price]));
  await Promise.all(tickers.filter((ticker) => !priceByTicker.has(ticker)).map(async (ticker) => {
    try { priceByTicker.set(ticker, (await getPriceInEurosOrLastKnown(ticker, exchangeRateCache)).price); } catch { /* shares just aren't shown */ }
  }));
  return priceByTicker;
}

router.get("/investments/allocation", async function getAllocation(request, response) {
  const newMoneyText = request.query.new_money;
  const newMoneyInCents = newMoneyText === undefined || newMoneyText === "" ? 0 : convertEurosToCents(newMoneyText);
  if (!(newMoneyInCents >= 0)) return response.status(400).json({ error: "new_money must be an amount in euros" });

  try {
    const targetBasisPointsByTicker = readTargetBasisPointsByTicker();
    const { valued, missingPrices, exchangeRateCache } = await valueHoldingsAtLivePrices();
    const holdingsInCents = valued.map((holding) => ({ ticker: holding.ticker, valueInCents: Math.round(holding.current_value * 100) }));
    const canCalculate = missingPrices.length === 0;
    const rows = describeAllocation(holdingsInCents, targetBasisPointsByTicker);
    const totalValueInCents = holdingsInCents.reduce((sum, holding) => sum + holding.valueInCents, 0);

    let split = null;
    if (canCalculate && newMoneyInCents > 0 && targetBasisPointsByTicker.size) {
      const buys = splitNewMoneyWithoutSelling(holdingsInCents, targetBasisPointsByTicker, newMoneyInCents);
      const priceByTicker = await findPricesOfTickers(buys.filter((buy) => buy.amountInCents > 0).map((buy) => buy.ticker), valued, exchangeRateCache);
      const holdingsAfter = holdingsInCents.map((holding) => ({ ...holding })); // the shares after buying, to show where it lands
      for (const buy of buys) {
        const holding = holdingsAfter.find((candidate) => candidate.ticker === buy.ticker);
        if (holding) holding.valueInCents += buy.amountInCents;
        else holdingsAfter.push({ ticker: buy.ticker, valueInCents: buy.amountInCents });
      }
      split = {
        new_money: convertCentsToEuros(newMoneyInCents),
        buys: buys.map((buy) => {
          const price = priceByTicker.get(buy.ticker) ?? null;
          const approximateShares = price && buy.amountInCents ? buy.amountInCents / 100 / price : null;
          return { ticker: buy.ticker, amount: convertCentsToEuros(buy.amountInCents), price, approximate_shares: approximateShares, whole_shares: approximateShares === null ? null : Math.floor(approximateShares) };
        }),
        after: describeAllocation(holdingsAfter, targetBasisPointsByTicker).map((row) => ({ ticker: row.ticker, share: row.currentShare, drift_points: row.driftPoints })),
      };
    }

    response.json({
      total_value: convertCentsToEuros(totalValueInCents),
      targets_set: targetBasisPointsByTicker.size > 0,
      drift_threshold_points: readSetting("allocation_drift_threshold_points"),
      missing_prices: missingPrices,
      rows: canCalculate ? rows.map((row) => ({
        ticker: row.ticker,
        value: convertCentsToEuros(row.valueInCents),
        current_share: row.currentShare,
        target_share: row.targetShare,
        drift_points: row.driftPoints,
        drift: convertCentsToEuros(row.driftInCents),
      })) : [...targetBasisPointsByTicker].map(([ticker, basisPoints]) => ({ ticker, value: null, current_share: null, target_share: basisPoints / BASIS_POINTS_IN_ONE, drift_points: null, drift: null })),
      split,
    });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

module.exports = router;
