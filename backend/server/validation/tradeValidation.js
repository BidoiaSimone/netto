/* CHECKS AN INVESTMENT TRADE SENT BY THE FRONTEND (add and edit follow the same rules) */

const db = require("../../db/databaseConnection.js");
const { convertEurosToCents } = require("../utils/moneyConversion.js");
const { getTodayAsLocalDate, parseDateOrDefaultToToday } = require("../utils/localDates.js");
const { getCurrentPriceInEuros } = require("../services/yahooFinanceMarketData.js");
const { normalizeTicker } = require("../services/holdingValuation.js");

const isEmpty = (value) => value === undefined || value === null || value === "";

// Returns { error } or { trade } (money in cents).
// The frontend sends the price of one share and the fees; the total is worked out here:
// a buy costs shares × price + fees, a sell brings in shares × price − fees.
// accountIdAlreadyUsed: the account the trade already used before an edit (allowed even if since closed)
function validateTrade(requestBody = {}, accountIdAlreadyUsed = null) {
  const ticker = normalizeTicker(requestBody.ticker);
  if (!ticker) return { error: "ticker is required" };
  if (requestBody.side !== "buy" && requestBody.side !== "sell") return { error: "side must be buy or sell" };

  const shares = Number(requestBody.shares);
  const pricePerShare = Number(requestBody.price);
  if (!Number.isFinite(shares) || shares <= 0) return { error: "shares must be a number greater than 0" };
  if (!Number.isFinite(pricePerShare) || pricePerShare <= 0) return { error: "price must be a number greater than 0" };
  const fees = isEmpty(requestBody.fees) ? 0 : convertEurosToCents(requestBody.fees);
  if (!Number.isFinite(fees) || fees < 0) return { error: "fees must be 0 or more" };

  const grossAmount = convertEurosToCents(shares * pricePerShare);
  const amount = requestBody.side === "buy" ? grossAmount + fees : grossAmount - fees;
  if (!(amount > 0)) return { error: "the fees can't be as big as the sale itself" };

  const date = parseDateOrDefaultToToday(requestBody.date);
  if (!date) return { error: "date must be a valid YYYY-MM-DD date" };
  if (date > getTodayAsLocalDate()) return { error: "date can't be in the future" };

  const accountId = isEmpty(requestBody.account_id) ? null : Number(requestBody.account_id);
  if (accountId !== null) {
    const account = db.prepare(`SELECT name, closed_at FROM accounts WHERE id = ?`).get(accountId);
    if (!account) return { error: `Unknown account id: ${requestBody.account_id}` };
    if (account.closed_at && accountId !== accountIdAlreadyUsed) return { error: `${account.name} is closed: reopen it on the Assets page to use it again` };
  }
  return { trade: { ticker, side: requestBody.side, shares, amount, fees, date, accountId, note: requestBody.note?.trim() || null } };
}

// A ticker never traded before must be one Yahoo knows: catches typos like VWCE.MX before they're saved.
// Returns an error message, or null when the ticker is fine.
async function findUnknownTickerError(ticker) {
  if (db.prepare(`SELECT 1 FROM investment_trades WHERE ticker = ?`).get(ticker)) return null;
  try {
    await getCurrentPriceInEuros(ticker, new Map());
    return null;
  } catch {
    return `Couldn't find a price for ${ticker}. Check the ticker as Yahoo Finance writes it (e.g. VWCE.MI for Milan), or try again if you're offline.`;
  }
}

module.exports = { validateTrade, findUnknownTickerError };
