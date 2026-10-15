/* FINANCIAL STATEMENTS FOR A PERIOD (Statements page)
 * The three statements a company publishes, for your own money, over any period from `from` to `to`:
 *
 *   income statement  income and expenses by category, and what's left (net savings)
 *   balance sheet     what every account and investment was worth the day before the period ("opening")
 *                     and on its last day ("closing"), grouped by liquidity class (config/accountKinds.js)
 *   net worth bridge  how the opening net worth became the closing one, step by step:
 *
 *       closing = opening + income − expenses + investment results + reconciliations + starting balances added
 *
 *     investment results   what the investments' value changed by, minus the money put in (buys) or
 *                          taken out (sells): market moves, with fees included
 *     reconciliations      the differences you found when counting an account
 *     starting balances    money that entered netto without a transaction: a new account's opening
 *                          balance (the car, when it was added), or shares bought without saying
 *                          which account paid (the "opening position" trades)
 *
 *   Movements between your own accounts change nothing; the cash side of a trade is part of the investment
 *   step. Every step is computed separately, so `unexplained` (closing − opening − all steps) is a check:
 *   it should always be 0.
 *
 * Balances on a past day are rebuilt the same way as the net worth chart (services/netWorthHistory.js).
 *
 * Next to the income statement: budget vs actual for the same period (services/budgetCalculator.js).
 * Also for the same period: the investments' real return, money- and time-weighted (services/investmentReturns.js),
 * and estimated Italian taxes (services/italianTaxEstimates.js). The taxes are estimates shown NEXT TO the
 * statements, never inside them: the bridge and the totals above only contain what netto recorded.
 */

const db = require("../../db/databaseConnection.js");
const { ACCOUNT_KINDS } = require("../../config/accountKinds.js");
const { calculateInvestmentsValuePerDay, addDays } = require("./netWorthHistory.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { buildBudgetVsActual } = require("./budgetCalculator.js");
const { listDaysNeededForReturns, buildInvestmentReturns } = require("./investmentReturns.js");
const { buildItalianTaxEstimates } = require("./italianTaxEstimates.js");

const LIQUIDITY_CLASS_ORDER = ["cash_and_equivalents", "restricted", "investments", "personal_use"];

// ---------- balance sheet ----------

// Every account with its balance at the end of `openingDay` and of `closingDay` (cents). An account
// counts from the day it starts: its open date, or its first transaction if that is earlier.
const selectAccountBalancesOnTwoDays = db.prepare(`
  WITH starts AS (
    SELECT a.id, a.name, a.kind, a.opening_balance,
           MIN(a.open_date, COALESCE((SELECT MIN(date) FROM transactions WHERE from_account_id = a.id OR to_account_id = a.id), a.open_date)) AS start_day
    FROM accounts a
  )
  SELECT s.id, s.name, s.kind, s.opening_balance, s.start_day,
         (CASE WHEN s.start_day <= $openingDay THEN s.opening_balance ELSE 0 END)
           + COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = s.id AND date <= $openingDay), 0)
           - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = s.id AND date <= $openingDay), 0) AS opening,
         (CASE WHEN s.start_day <= $closingDay THEN s.opening_balance ELSE 0 END)
           + COALESCE((SELECT SUM(amount) FROM transactions WHERE to_account_id = s.id AND date <= $closingDay), 0)
           - COALESCE((SELECT SUM(amount) FROM transactions WHERE from_account_id = s.id AND date <= $closingDay), 0) AS closing
  FROM starts s ORDER BY s.id
`);

// { classes: [{ key, opening, closing, items: [{ name, kind, opening, closing }] }], opening, closing } in cents.
// Accounts at zero on both days (or not started yet) are left out.
function buildBalanceSheet(accountRows, investmentRows) {
  const classes = LIQUIDITY_CLASS_ORDER.map((key) => ({ key, opening: 0, closing: 0, items: [] }));
  const classByKey = new Map(classes.map((liquidityClass) => [liquidityClass.key, liquidityClass]));

  const addItem = (classKey, item) => {
    if (item.opening === 0 && item.closing === 0) return;
    const liquidityClass = classByKey.get(classKey);
    liquidityClass.items.push(item);
    liquidityClass.opening += item.opening;
    liquidityClass.closing += item.closing;
  };
  for (const account of accountRows) {
    addItem(ACCOUNT_KINDS[account.kind].liquidity, { name: account.name, kind: account.kind, opening: account.opening, closing: account.closing });
  }
  for (const investment of investmentRows) addItem("investments", { name: investment.ticker, kind: "investment", ...investment });

  return {
    classes,
    opening: classes.reduce((sum, liquidityClass) => sum + liquidityClass.opening, 0),
    closing: classes.reduce((sum, liquidityClass) => sum + liquidityClass.closing, 0),
  };
}

// ---------- income statement ----------

const selectTotalsByCategory = db.prepare(`
  SELECT t.category_id, COALESCE(c.name, 'Uncategorized') AS name, SUM(t.amount) AS total
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.type = $type AND t.date BETWEEN $from AND $to
  GROUP BY t.category_id ORDER BY total DESC
`);

function buildIncomeStatement(from, to) {
  const income = selectTotalsByCategory.all({ type: "income", from, to });
  const expenses = selectTotalsByCategory.all({ type: "expense", from, to });
  const totalIncome = income.reduce((sum, row) => sum + row.total, 0);
  const totalExpenses = expenses.reduce((sum, row) => sum + row.total, 0);
  return { income, expenses, totalIncome, totalExpenses };
}

// ---------- net worth bridge ----------

// Money effects of the period's transactions, by kind (cents)
const selectTransactionEffects = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN type = 'adjustment' THEN (CASE WHEN to_account_id IS NOT NULL THEN amount ELSE -amount END) END), 0) AS reconciliations,
    COALESCE(SUM(CASE WHEN type = 'investment' THEN (CASE WHEN to_account_id IS NOT NULL THEN amount ELSE -amount END) END), 0) AS investmentCash
  FROM transactions WHERE date BETWEEN $from AND $to
`);
const selectTradeTotals = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN side = 'buy' THEN amount END), 0) AS bought,
         COALESCE(SUM(CASE WHEN side = 'sell' THEN amount END), 0) AS sold
  FROM investment_trades WHERE date BETWEEN $from AND $to
`);

function buildBridge({ from, to, accountRows, incomeStatement, investmentsOpening, investmentsClosing, opening, closing }) {
  const { reconciliations, investmentCash } = selectTransactionEffects.get({ from, to });
  const { bought, sold } = selectTradeTotals.get({ from, to });
  const moneyPutIntoInvestments = bought - sold;

  const openingBalancesOfNewAccounts = accountRows
    .filter((account) => account.start_day >= from && account.start_day <= to)
    .reduce((sum, account) => sum + account.opening_balance, 0);
  // investmentCash is what left your accounts for trades (negative when buying); whatever the trades
  // put in beyond that came from outside netto
  const tradesWithoutPayment = moneyPutIntoInvestments + investmentCash;

  const steps = [
    { key: "income", label: "Income", amount: incomeStatement.totalIncome },
    { key: "expenses", label: "Expenses", amount: -incomeStatement.totalExpenses },
    { key: "investment_results", label: "Investment results", amount: investmentsClosing - investmentsOpening - moneyPutIntoInvestments },
    { key: "reconciliations", label: "Reconciliations", amount: reconciliations },
    { key: "starting_balances", label: "Starting balances added", amount: openingBalancesOfNewAccounts + tradesWithoutPayment },
  ];
  const explained = steps.reduce((sum, step) => sum + step.amount, 0);
  return { opening, steps, closing, unexplained: closing - opening - explained };
}

// ---------- everything together ----------

// from, to: YYYY-MM-DD, already checked (from <= to <= today). Money in euros.
async function buildFinancialStatements(from, to) {
  const openingDay = addDays(from, -1);
  const accountRows = selectAccountBalancesOnTwoDays.all({ openingDay, closingDay: to });

  // One valuation for everything: the two ends of the period (balance sheet) plus the trade days (returns).
  // Same first and last day as before, so the prices, and the balance sheet, are exactly what they were.
  const valuationDays = listDaysNeededForReturns(openingDay, to);
  const valuation = await calculateInvestmentsValuePerDay(valuationDays);
  const { tickerResults, tickersValuedAtCost } = valuation;
  const lastIndex = valuationDays.length - 1;
  const totals = [valuation.totals[0], valuation.totals[lastIndex]];
  const investmentRows = tickerResults.map((result) => ({ ticker: result.ticker, opening: result.valuesInCents[0], closing: result.valuesInCents[lastIndex] }));

  const balanceSheet = buildBalanceSheet(accountRows, investmentRows);
  const incomeStatement = buildIncomeStatement(from, to);
  const bridge = buildBridge({
    from, to, accountRows, incomeStatement,
    investmentsOpening: totals[0], investmentsClosing: totals[1],
    opening: balanceSheet.opening, closing: balanceSheet.closing,
  });

  const investmentReturns = buildInvestmentReturns({ openingDay, to, days: valuationDays, valuation });
  const taxEstimates = buildItalianTaxEstimates({
    from, to, openingDay, accountRows,
    investmentValues: {
      opening: new Map(investmentRows.map((row) => [row.ticker, row.opening])),
      closing: new Map(investmentRows.map((row) => [row.ticker, row.closing])),
    },
    netWorthOpening: balanceSheet.opening, netWorthClosing: balanceSheet.closing,
  });

  const toEuros = convertCentsToEuros;
  const categoryRowToEuros = (row) => ({ category_id: row.category_id, name: row.name, total: toEuros(row.total) });
  const netSavings = incomeStatement.totalIncome - incomeStatement.totalExpenses;
  return {
    from, to, opening_day: openingDay,
    income_statement: {
      income: incomeStatement.income.map(categoryRowToEuros),
      expenses: incomeStatement.expenses.map(categoryRowToEuros),
      total_income: toEuros(incomeStatement.totalIncome),
      total_expenses: toEuros(incomeStatement.totalExpenses),
      net_savings: toEuros(netSavings),
      savings_rate: incomeStatement.totalIncome > 0 ? netSavings / incomeStatement.totalIncome : null, // 0.25 = 25%
    },
    balance_sheet: {
      classes: balanceSheet.classes.map((liquidityClass) => ({
        key: liquidityClass.key,
        opening: toEuros(liquidityClass.opening),
        closing: toEuros(liquidityClass.closing),
        items: liquidityClass.items.map((item) => ({ ...item, opening: toEuros(item.opening), closing: toEuros(item.closing) })),
      })),
      opening: toEuros(balanceSheet.opening),
      closing: toEuros(balanceSheet.closing),
    },
    bridge: {
      opening: toEuros(bridge.opening),
      steps: bridge.steps.map((step) => ({ ...step, amount: toEuros(step.amount) })),
      closing: toEuros(bridge.closing),
      unexplained: toEuros(bridge.unexplained), // should be 0: anything else is a bug
    },
    budget_vs_actual: buildBudgetVsActual(from, to),
    investment_returns: investmentReturns,
    tax_estimates: taxEstimates, // estimates only: not in any total above
    failed_tickers: tickersValuedAtCost, // no price history: valued at what they cost
  };
}

module.exports = { buildFinancialStatements };
