/* INVESTMENT TRADES: every buy and sell with its date.
 * After every change the holding is recalculated from its trades (services/holdingsCalculator.js),
 * so editing or deleting a trade always keeps it right. A trade can also move cash from / into an
 * account (services/tradeCashTransactions.js).
 * The database stores cents; the API speaks euros, like everywhere else.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { sendErrorResponse } = require("../utils/httpErrors.js");
const { validateTrade, findUnknownTickerError } = require("../validation/tradeValidation.js");
const { rebuildHoldingFromTrades, calculateRealizedGainOfEverySale } = require("../services/holdingsCalculator.js");
const { syncCashTransactionOfTrade } = require("../services/tradeCashTransactions.js");

const router = express.Router();

const selectTradeById = db.prepare(`SELECT * FROM investment_trades WHERE id = ?`);

// The price of one share, worked back from the total (fees are added to a buy, taken from a sale)
const calculatePricePerShare = (tradeRow) =>
  (tradeRow.side === "buy" ? tradeRow.amount - tradeRow.fees : tradeRow.amount + tradeRow.fees) / 100 / tradeRow.shares;

// Every trade, newest first, with the account name, the price of one share and, for sells,
// the gain realized (worked out by replaying the trades)
router.get("/investments/trades", function listTrades(request, response) {
  const realizedGainByTradeId = calculateRealizedGainOfEverySale();
  const tradeRows = db.prepare(`
    SELECT t.*, a.name AS account FROM investment_trades t LEFT JOIN accounts a ON a.id = t.account_id
    ORDER BY t.date DESC, t.id DESC
  `).all();
  response.json(tradeRows.map((tradeRow) => ({
    ...tradeRow,
    amount: convertCentsToEuros(tradeRow.amount),
    fees: convertCentsToEuros(tradeRow.fees),
    price: calculatePricePerShare(tradeRow),
    realized_gain: realizedGainByTradeId.has(tradeRow.id) ? convertCentsToEuros(realizedGainByTradeId.get(tradeRow.id)) : null,
  })));
});

router.post("/investments/trades", async function addTrade(request, response) {
  const { error, trade } = validateTrade(request.body);
  if (error) return response.status(400).json({ error });
  const unknownTickerError = await findUnknownTickerError(trade.ticker);
  if (unknownTickerError) return response.status(400).json({ error: unknownTickerError });

  try {
    const newTradeId = db.transaction(() => {
      const cashTransactionId = syncCashTransactionOfTrade(trade, null);
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO investment_trades (ticker, side, date, shares, amount, fees, account_id, transaction_id, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(trade.ticker, trade.side, trade.date, trade.shares, trade.amount, trade.fees, trade.accountId, cashTransactionId, trade.note);
      rebuildHoldingFromTrades(trade.ticker); // throws (and undoes everything) if e.g. selling more than held
      return lastInsertRowid;
    })();
    response.status(201).json({ message: "Trade saved", id: newTradeId });
  } catch (error) {
    sendErrorResponse(response, error);
  }
});

// Edit a trade (the body is the whole trade, like when adding one). The holding is recalculated,
// and its cash transaction follows: changed, created or removed to match the account chosen.
router.put("/investments/trades/:id", async function editTrade(request, response) {
  const tradeId = Number(request.params.id);
  const existingTrade = selectTradeById.get(tradeId);
  if (!existingTrade) return response.status(404).json({ error: "Trade not found" });

  const { error, trade } = validateTrade(request.body, existingTrade.account_id);
  if (error) return response.status(400).json({ error });
  if (trade.ticker !== existingTrade.ticker) {
    const unknownTickerError = await findUnknownTickerError(trade.ticker);
    if (unknownTickerError) return response.status(400).json({ error: unknownTickerError });
  }

  try {
    db.transaction(() => {
      const cashTransactionId = syncCashTransactionOfTrade(trade, existingTrade.transaction_id);
      db.prepare(`
        UPDATE investment_trades
        SET ticker = ?, side = ?, date = ?, shares = ?, amount = ?, fees = ?, account_id = ?, transaction_id = ?, note = ?
        WHERE id = ?
      `).run(trade.ticker, trade.side, trade.date, trade.shares, trade.amount, trade.fees, trade.accountId, cashTransactionId, trade.note, tradeId);
      rebuildHoldingFromTrades(trade.ticker);
      if (existingTrade.ticker !== trade.ticker) rebuildHoldingFromTrades(existingTrade.ticker);
    })();
    response.json({ message: "Trade updated", id: tradeId });
  } catch (error) {
    sendErrorResponse(response, error);
  }
});

// Delete a trade: its cash goes back to the account and the holding is recalculated.
// Refused if a later sell would then be selling shares that were never bought.
router.delete("/investments/trades/:id", function deleteTrade(request, response) {
  const tradeId = Number(request.params.id);
  const existingTrade = selectTradeById.get(tradeId);
  if (!existingTrade) return response.status(404).json({ error: "Trade not found" });

  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM investment_trades WHERE id = ?`).run(tradeId);
      if (existingTrade.transaction_id) db.prepare(`DELETE FROM transactions WHERE id = ?`).run(existingTrade.transaction_id);
      rebuildHoldingFromTrades(existingTrade.ticker);
    })();
    response.json({ message: "Trade deleted" });
  } catch (error) {
    sendErrorResponse(response, error);
  }
});

module.exports = router;
