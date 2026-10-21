/* THE FOREIGN-CURRENCY SIDE OF A TRANSACTION, as the API shows it (migration 14). Pure maths, no database.
 *
 * Two rates are compared, both written "units of the currency per 1 €" (how EUR/JPY is quoted):
 *   market rate    the day's rate on the markets (stored with the transaction)
 *   charged rate   the one your card or the ATM really used = foreign amount / euros charged
 *
 * The exchange cost is how many euros that difference cost you, against the market value of the foreign amount
 * (foreign amount / market rate):
 *   spending (expense, movement)   cost = euros charged − market value     (paid 7,60 € for what was worth 7,50 €: 0,10 €)
 *   receiving (income, a refund)   cost = market value − euros received    (got 7,40 € for what was worth 7,50 €: 0,10 €)
 * Positive = it cost you; negative = the rate was in your favour. Worked out in cents, so totals add up exactly.
 */

const { convertFromMinorUnits } = require("../../config/currencies.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

// The market value of the foreign amount, in euro cents (null without a market rate)
function calculateMarketValueInCents(transactionRow) {
  if (!transactionRow.original_currency || !transactionRow.original_market_rate) return null;
  const foreignAmount = convertFromMinorUnits(transactionRow.original_amount_minor, transactionRow.original_currency);
  return Math.round(Number(((foreignAmount / transactionRow.original_market_rate) * 100).toPrecision(15)));
}

// In euro cents; null when the currency or the market rate is missing
function calculateExchangeCostInCents(transactionRow) {
  const marketValueInCents = calculateMarketValueInCents(transactionRow);
  if (marketValueInCents === null) return null;
  return transactionRow.type === "income" ? marketValueInCents - transactionRow.amount : transactionRow.amount - marketValueInCents;
}

// The fields the API adds to a transaction (or a recurring rule): all null when it was paid in euros.
// transactionRow: a database row, `amount` in euro cents.
function describeForeignAmount(transactionRow) {
  if (!transactionRow.original_currency) {
    return { original_currency: null, original_amount: null, original_market_rate: null, charged_rate: null, exchange_cost: null, exchange_cost_share: null };
  }
  const foreignAmount = convertFromMinorUnits(transactionRow.original_amount_minor, transactionRow.original_currency);
  const exchangeCostInCents = calculateExchangeCostInCents(transactionRow);
  const marketValueInCents = calculateMarketValueInCents(transactionRow);
  return {
    original_currency: transactionRow.original_currency,
    original_amount: foreignAmount,
    original_market_rate: transactionRow.original_market_rate ?? null,
    charged_rate: transactionRow.amount > 0 ? foreignAmount / (transactionRow.amount / 100) : null,
    exchange_cost: convertCentsToEuros(exchangeCostInCents),
    exchange_cost_share: exchangeCostInCents === null || !marketValueInCents ? null : exchangeCostInCents / marketValueInCents,
  };
}

module.exports = { calculateMarketValueInCents, calculateExchangeCostInCents, describeForeignAmount };
