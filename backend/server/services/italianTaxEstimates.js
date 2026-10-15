/* ITALIAN TAXES, ESTIMATED (Statements page). Rates and sources: config/italianTaxRates.js
 *
 * ESTIMATES, NEXT TO the real figures, never inside them: netto doesn't record what Directa or the bank actually
 * withheld, so nothing here touches a balance, the income statement totals or the net worth bridge.
 *
 *   deferred tax       what selling everything on that day would cost in tax: 26% of each holding's gain over its
 *                      average cost, only where there is a gain (ETF gains are taxed one by one: a loss on one ETF
 *                      doesn't reduce the tax on another). Shown on the balance sheet, with net worth after tax.
 *   stamp duty         imposta di bollo for the period, prorated by days:
 *     on securities      0.2% a year of the investments' market value at the end of the period (as the bank does at
 *                        the end of each statement period)
 *     on current accounts 34.20 € a year for each current account whose average balance in the period is over 5,000 €.
 *                        The law sums all current accounts at the SAME bank; netto doesn't know which bank an account
 *                        is at, so each account is checked on its own (say so wherever this is shown)
 *   capital gains tax  26% of the gain of each sell in the period (gains only: ETF losses can't offset ETF gains)
 */

const db = require("../../db/databaseConnection.js");
const { ITALIAN_TAX_RATES } = require("../../config/italianTaxRates.js");
const { replayTrades } = require("./holdingsCalculator.js");
const { countDaysBetween } = require("./rateOfReturn.js");
const { addDays } = require("./netWorthHistory.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

const DAYS_PER_YEAR = 365;
const taxOnGain = (gainInCents) => Math.round(Math.max(0, gainInCents) * ITALIAN_TAX_RATES.capitalGainsTaxRate);

function loadTradesByTicker() {
  const tradesByTicker = new Map();
  for (const trade of db.prepare(`SELECT * FROM investment_trades`).all()) {
    if (!tradesByTicker.has(trade.ticker)) tradesByTicker.set(trade.ticker, []);
    tradesByTicker.get(trade.ticker).push(trade);
  }
  return tradesByTicker;
}

// ---------- deferred tax on unrealized gains (balance sheet) ----------

// On `day`, for each ticker: value (cents, from the balance sheet) − average cost of the shares held that day
function calculateDeferredTax(day, valueInCentsByTicker, tradesByTicker) {
  const holdings = [];
  for (const [ticker, valueInCents] of valueInCentsByTicker) {
    const tradesUpToDay = (tradesByTicker.get(ticker) ?? []).filter((trade) => trade.date <= day);
    const replayResult = tradesUpToDay.length ? replayTrades(tradesUpToDay) : { cost: 0 };
    const cost = replayResult.error ? 0 : replayResult.cost;
    if (!valueInCents && !cost) continue;
    holdings.push({ ticker, value: valueInCents, cost, unrealizedGain: valueInCents - cost, tax: taxOnGain(valueInCents - cost) });
  }
  return { holdings, total: holdings.reduce((sum, holding) => sum + holding.tax, 0) };
}

// ---------- stamp duty on current accounts ----------

// Average of each current account's end-of-day balance over the days from `from` to `to` (cents)
function calculateAverageBalancesOfCurrentAccounts(from, to, openingDay, accountRows) {
  const days = countDaysBetween(openingDay, to);
  const dailyChanges = db.prepare(`
    SELECT date, SUM(CASE WHEN to_account_id = $id THEN amount ELSE 0 END) - SUM(CASE WHEN from_account_id = $id THEN amount ELSE 0 END) AS change
    FROM transactions WHERE (to_account_id = $id OR from_account_id = $id) AND date BETWEEN $from AND $to
    GROUP BY date
  `);
  return accountRows.filter((account) => account.kind === "bank").map((account) => {
    const changeByDay = new Map(dailyChanges.all({ id: account.id, from, to }).map((row) => [row.date, row.change]));
    // the opening balance arrives on the day the account starts (see financialStatements.js)
    if (account.start_day >= from && account.start_day <= to) changeByDay.set(account.start_day, (changeByDay.get(account.start_day) ?? 0) + account.opening_balance);
    let balance = account.opening, sumOfDailyBalances = 0; // `opening` = end of the day before the period
    for (let day = from; day <= to; day = addDays(day, 1)) {
      balance += changeByDay.get(day) ?? 0;
      sumOfDailyBalances += balance;
    }
    return { name: account.name, averageBalance: Math.round(sumOfDailyBalances / days) };
  });
}

// ---------- capital gains tax on sells in the period ----------

function calculateCapitalGainsTaxOnSells(from, to, tradesByTicker) {
  const sells = [];
  for (const trades of tradesByTicker.values()) {
    const replayResult = replayTrades(trades);
    if (replayResult.error) continue;
    for (const trade of trades) {
      if (trade.side !== "sell" || trade.date < from || trade.date > to) continue;
      const gain = replayResult.realizedGainByTradeId.get(trade.id);
      sells.push({ ticker: trade.ticker, date: trade.date, gain, tax: taxOnGain(gain) });
    }
  }
  return sells.sort((first, second) => (first.date < second.date ? -1 : 1));
}

// ---------- everything together ----------

// from, to, openingDay: the period (checked); accountRows: from financialStatements (with opening, start_day);
// investmentValues: { opening: Map ticker -> cents, closing: Map ticker -> cents }. Money in euros.
function buildItalianTaxEstimates({ from, to, openingDay, accountRows, investmentValues, netWorthOpening, netWorthClosing }) {
  const days = countDaysBetween(openingDay, to);
  const shareOfYear = days / DAYS_PER_YEAR;
  const tradesByTicker = loadTradesByTicker();

  const deferredOpening = calculateDeferredTax(openingDay, investmentValues.opening, tradesByTicker);
  const deferredClosing = calculateDeferredTax(to, investmentValues.closing, tradesByTicker);

  const securitiesValueAtEnd = [...investmentValues.closing.values()].reduce((sum, value) => sum + value, 0);
  const stampDutyOnSecurities = Math.round(securitiesValueAtEnd * ITALIAN_TAX_RATES.stampDutyOnSecuritiesYearlyRate * shareOfYear);

  const currentAccounts = calculateAverageBalancesOfCurrentAccounts(from, to, openingDay, accountRows).map((account) => {
    const isOverThreshold = account.averageBalance > ITALIAN_TAX_RATES.stampDutyOnCurrentAccountsThresholdInCents;
    return {
      name: account.name,
      average_balance: convertCentsToEuros(account.averageBalance),
      stamp_duty: convertCentsToEuros(isOverThreshold ? Math.round(ITALIAN_TAX_RATES.stampDutyOnCurrentAccountsYearlyAmountInCents * shareOfYear) : 0),
    };
  });
  const stampDutyOnCurrentAccounts = currentAccounts.reduce((sum, account) => sum + Math.round(account.stamp_duty * 100), 0);

  const sells = calculateCapitalGainsTaxOnSells(from, to, tradesByTicker);
  const capitalGainsTax = sells.reduce((sum, sell) => sum + sell.tax, 0);

  const toEuros = convertCentsToEuros;
  const holdingToApi = (holding) => ({ ticker: holding.ticker, value: toEuros(holding.value), cost: toEuros(holding.cost), unrealized_gain: toEuros(holding.unrealizedGain), tax: toEuros(holding.tax) });
  return {
    rates: {
      capital_gains: ITALIAN_TAX_RATES.capitalGainsTaxRate,
      stamp_duty_on_securities_per_year: ITALIAN_TAX_RATES.stampDutyOnSecuritiesYearlyRate,
      stamp_duty_on_current_accounts_per_year: toEuros(ITALIAN_TAX_RATES.stampDutyOnCurrentAccountsYearlyAmountInCents),
      stamp_duty_threshold: toEuros(ITALIAN_TAX_RATES.stampDutyOnCurrentAccountsThresholdInCents),
      last_checked: ITALIAN_TAX_RATES.lastChecked,
    },
    days,
    balance_sheet: {
      deferred_tax_opening: toEuros(deferredOpening.total),
      deferred_tax_closing: toEuros(deferredClosing.total),
      net_worth_after_tax_opening: toEuros(netWorthOpening - deferredOpening.total),
      net_worth_after_tax_closing: toEuros(netWorthClosing - deferredClosing.total),
      holdings: deferredClosing.holdings.map(holdingToApi),
    },
    period: {
      stamp_duty_on_securities: toEuros(stampDutyOnSecurities),
      securities_value_at_end: toEuros(securitiesValueAtEnd),
      stamp_duty_on_current_accounts: toEuros(stampDutyOnCurrentAccounts),
      current_accounts: currentAccounts,
      capital_gains_tax: toEuros(capitalGainsTax),
      sells: sells.map((sell) => ({ ticker: sell.ticker, date: sell.date, gain: toEuros(sell.gain), tax: toEuros(sell.tax) })),
      total: toEuros(stampDutyOnSecurities + stampDutyOnCurrentAccounts + capitalGainsTax),
    },
  };
}

module.exports = { buildItalianTaxEstimates };
