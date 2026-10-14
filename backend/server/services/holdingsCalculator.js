/* HOLDINGS FROM TRADES
 * A holding (a row of `investments`) is never typed in: it is what its trades add up to.
 * Every time a trade is added, changed or deleted, rebuildHoldingFromTrades() replays all the trades
 * of that ticker in date order and stores the result. Same idea as the account balances kept by
 * triggers: the database always shows the real state, and the history is what it comes from.
 *
 * Cost uses the AVERAGE COST method (the usual one for funds/ETFs in Italy):
 *   buy  -> shares go up, cost goes up by what you paid (fees included)
 *   sell -> the shares sold take away their share of the cost: cost × sold / held.
 *           What you received minus that cost is the realized gain (or loss).
 * Money is in integer cents; shares can be fractional.
 */

const db = require("../../db/databaseConnection.js");
const { createHttpError } = require("../utils/httpErrors.js");

const SHARE_COUNT_TOLERANCE = 1e-9; // shares are floats: anything this small is zero
const removeShareFloatNoise = (shareCount) => Math.round(shareCount * 1e8) / 1e8; // 2.9999999999999996 -> 3
const formatShareCount = (shareCount) => String(removeShareFloatNoise(shareCount));

const compareTradesByDateThenId = (first, second) =>
  first.date < second.date ? -1 : first.date > second.date ? 1 : first.id - second.id;

// trades: one ticker's trades in any order.
// Returns { shares, cost, realizedGain, realizedGainByTradeId } or { error }.
// realizedGainByTradeId: trade id -> realized gain of that sell (cents).
function replayTrades(trades) {
  const tradesInOrder = [...trades].sort(compareTradesByDateThenId);
  let sharesHeld = 0, costOfSharesHeld = 0, totalRealizedGain = 0;
  const realizedGainByTradeId = new Map();

  for (const trade of tradesInOrder) {
    if (trade.side === "buy") {
      sharesHeld = removeShareFloatNoise(sharesHeld + trade.shares);
      costOfSharesHeld += trade.amount;
      continue;
    }
    if (trade.shares > sharesHeld + SHARE_COUNT_TOLERANCE) {
      return { error: `On ${trade.date} that would sell ${formatShareCount(trade.shares)} ${trade.ticker}, but only ${formatShareCount(sharesHeld)} are held at that date` };
    }
    const sharesLeft = removeShareFloatNoise(sharesHeld - trade.shares);
    const soldEverything = sharesLeft < SHARE_COUNT_TOLERANCE;
    const costOfSharesSold = soldEverything ? costOfSharesHeld : Math.round((costOfSharesHeld * trade.shares) / sharesHeld);
    const gainOfThisSale = trade.amount - costOfSharesSold;
    realizedGainByTradeId.set(trade.id, gainOfThisSale);
    totalRealizedGain += gainOfThisSale;
    costOfSharesHeld -= costOfSharesSold;
    sharesHeld = soldEverything ? 0 : sharesLeft;
    if (sharesHeld === 0) costOfSharesHeld = 0;
  }
  return { shares: sharesHeld, cost: costOfSharesHeld, realizedGain: totalRealizedGain, realizedGainByTradeId };
}

const selectTradesOfTicker = db.prepare(`SELECT * FROM investment_trades WHERE ticker = ?`);

// Recalculates one ticker's holding from its trades. Throws a 400 error if the trades don't make sense
// (e.g. selling more than held at that date): call it inside db.transaction() so the change is undone.
function rebuildHoldingFromTrades(ticker) {
  const trades = selectTradesOfTicker.all(ticker);
  if (!trades.length) {
    db.prepare(`DELETE FROM investments WHERE ticker = ?`).run(ticker);
    return;
  }
  const replayResult = replayTrades(trades);
  if (replayResult.error) throw createHttpError(400, replayResult.error);
  db.prepare(`
    INSERT INTO investments (ticker, shares, amount_invested, realized_gain) VALUES (?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET shares = excluded.shares, amount_invested = excluded.amount_invested,
                                      realized_gain = excluded.realized_gain
  `).run(ticker, replayResult.shares, replayResult.cost, replayResult.realizedGain);
}

// Realized gain of every sell of every ticker, by trade id (cents)
function calculateRealizedGainOfEverySale() {
  const tradesByTicker = new Map();
  for (const trade of db.prepare(`SELECT * FROM investment_trades`).all()) {
    if (!tradesByTicker.has(trade.ticker)) tradesByTicker.set(trade.ticker, []);
    tradesByTicker.get(trade.ticker).push(trade);
  }
  const realizedGainByTradeId = new Map();
  for (const tradesOfOneTicker of tradesByTicker.values()) {
    const replayResult = replayTrades(tradesOfOneTicker);
    if (replayResult.error) continue;
    for (const [tradeId, gain] of replayResult.realizedGainByTradeId) realizedGainByTradeId.set(tradeId, gain);
  }
  return realizedGainByTradeId;
}

module.exports = { replayTrades, rebuildHoldingFromTrades, calculateRealizedGainOfEverySale, formatShareCount };
