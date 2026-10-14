/* NET WORTH = what the accounts hold + what the investments are worth at today's prices,
 * also split by liquidity class (see config/accountKinds.js) for the Insights page.
 */

const db = require("../../db/databaseConnection.js");
const { getCurrentPriceInEuros } = require("./yahooFinanceMarketData.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { ACCOUNT_KINDS } = require("../../config/accountKinds.js");

// { cash_and_equivalents, restricted, personal_use } in euros, from the account balances.
// Closed accounts are at 0, so they don't change anything.
function sumAccountsByLiquidity() {
  const totals = { cash_and_equivalents: 0, restricted: 0, personal_use: 0 };
  const balanceOfEachKind = db.prepare(`SELECT kind, SUM(balance) AS total FROM accounts GROUP BY kind`).all();
  for (const { kind, total } of balanceOfEachKind) totals[ACCOUNT_KINDS[kind].liquidity] += total;
  for (const liquidityClass of Object.keys(totals)) totals[liquidityClass] = convertCentsToEuros(totals[liquidityClass]);
  return totals;
}

async function calculateNetWorth() {
  const accountsValue = convertCentsToEuros(db.prepare(`SELECT COALESCE(SUM(balance), 0) AS total FROM accounts`).get().total);
  const holdings = db.prepare(`SELECT ticker, shares FROM investments WHERE shares > 0`).all();

  // One failing ticker must not hide the whole net worth, so it is reported instead
  const exchangeRateCache = new Map();
  const prices = await Promise.allSettled(holdings.map((holding) => getCurrentPriceInEuros(holding.ticker, exchangeRateCache)));

  let investmentsValue = 0;
  const failedTickers = [];
  prices.forEach((price, index) => {
    if (price.status === "fulfilled") investmentsValue += holdings[index].shares * price.value;
    else failedTickers.push(holdings[index].ticker);
  });

  return {
    net_worth: accountsValue + investmentsValue,
    accounts_value: accountsValue,
    investments_value: investmentsValue,
    // the same total, from most to least liquid
    by_liquidity: { ...sumAccountsByLiquidity(), investments: investmentsValue },
    failed_tickers: failedTickers, // not included in the totals above
  };
}

module.exports = { calculateNetWorth };
