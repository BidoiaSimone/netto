// ---- Insights page: income and spending of the last months, and this month's money by category ----
// Movements, reconciliation adjustments and investment trades are not income or spending.
// (This month: monthProjection.js; Liquidity: liquidityInsights.js; the net worth chart: netWorthHistoryChart.js.)

import { fillTableBody } from "../core/domHelpers.js";
import { euroFormatter, getTodayAsLocalDate } from "../core/formatting.js";
import { appState } from "../core/appState.js";
import { renderLiquidityInsights } from "./liquidityInsights.js";
import { renderMonthProjection } from "./monthProjection.js";

const NUMBER_OF_MONTHS_SHOWN = 6;
const UNCATEGORIZED_KEY = "uncategorized";

// Totals are kept by category id (two categories can share a name: an income "Gift" and an expense "Gift").
// The name comes with each transaction (the server joins it in).
function sumThisMonthByCategory(transactionType, currentMonth) {
  const totalByCategoryId = new Map(); // id (or "uncategorized") -> { name, total }
  for (const transaction of appState.transactions) {
    if (transaction.type !== transactionType || !transaction.date.startsWith(currentMonth)) continue;
    const key = transaction.category_id ?? UNCATEGORIZED_KEY;
    if (!totalByCategoryId.has(key)) totalByCategoryId.set(key, { name: transaction.category ?? "Uncategorized", total: 0 });
    totalByCategoryId.get(key).total += transaction.amount;
  }
  return [...totalByCategoryId.values()].sort((first, second) => second.total - first.total);
}

function sumByMonth() {
  const totalsByMonth = {}; // "2026-10" -> { income, expense }
  for (const transaction of appState.transactions) {
    const monthTotals = (totalsByMonth[transaction.date.slice(0, 7)] ??= { income: 0, expense: 0 });
    if (transaction.type === "income") monthTotals.income += transaction.amount;
    if (transaction.type === "expense") monthTotals.expense += transaction.amount;
  }
  return totalsByMonth;
}

// Savings rate: the part of the income that wasn't spent. "—" in a month without income.
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const formatSavingsRate = ({ income, expense }) => (income > 0 ? percentFormatter.format((income - expense) / income) : "—");

export function renderInsightsPage() {
  const totalsByMonth = sumByMonth();
  const latestMonths = Object.keys(totalsByMonth).sort().reverse().slice(0, NUMBER_OF_MONTHS_SHOWN);
  fillTableBody("months-body", latestMonths, (month) => [
    month,
    euroFormatter.format(totalsByMonth[month].income),
    euroFormatter.format(totalsByMonth[month].expense),
    euroFormatter.format(totalsByMonth[month].income - totalsByMonth[month].expense),
    formatSavingsRate(totalsByMonth[month]),
  ]);

  const currentMonth = getTodayAsLocalDate().slice(0, 7);
  const formatRow = ({ name, total }) => [name, euroFormatter.format(total)];
  fillTableBody("cats-body", sumThisMonthByCategory("expense", currentMonth), formatRow);
  fillTableBody("income-cats-body", sumThisMonthByCategory("income", currentMonth), formatRow);

  renderLiquidityInsights(); // its emergency fund uses the monthly expenses
  renderMonthProjection();
}
