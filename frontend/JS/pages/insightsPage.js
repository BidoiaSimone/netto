// ---- Insights page: income and spending of the last months, and this month's money by category ----
// Movements, reconciliation adjustments and investment trades are not income or spending.
// (This month: monthProjection.js; Liquidity: liquidityInsights.js; the net worth chart: netWorthHistoryChart.js.)
// netto light has no projection: its This month is just the month's totals so far (renderThisMonthTotals below).

import { elementById, fillTableBody } from "../core/domHelpers.js";
import { euroFormatter, formatCount, getTodayAsLocalDate } from "../core/formatting.js";
import { appState } from "../core/appState.js";
import { isLightEdition } from "../core/edition.js";
import { renderMonthProjection } from "./monthProjection.js";
import { createCategoryLabel } from "../core/categoryIcons.js";

const NUMBER_OF_MONTHS_SHOWN = 6;
const UNCATEGORIZED_KEY = "uncategorized";

// Totals are kept by category id (two categories can share a name: an income "Gift" and an expense "Gift").
// The name comes with each transaction (the server joins it in).
function sumThisMonthByCategory(transactionType, currentMonth) {
  const totalByCategoryId = new Map(); // id (or "uncategorized") -> { categoryId, name, total }
  for (const transaction of appState.transactions) {
    if (transaction.type !== transactionType || !transaction.date.startsWith(currentMonth)) continue;
    const key = transaction.category_id ?? UNCATEGORIZED_KEY;
    if (!totalByCategoryId.has(key)) totalByCategoryId.set(key, { categoryId: transaction.category_id, name: transaction.category ?? "Uncategorized", total: 0 });
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
  const formatRow = ({ categoryId, name, total }) => [createCategoryLabel(categoryId, name), euroFormatter.format(total)];
  fillTableBody("cats-body", sumThisMonthByCategory("expense", currentMonth), formatRow);
  fillTableBody("income-cats-body", sumThisMonthByCategory("income", currentMonth), formatRow);

  if (isLightEdition) renderThisMonthTotals(totalsByMonth[currentMonth] ?? { income: 0, expense: 0 }, currentMonth);
  else renderMonthProjection();
}

// netto light > Insights > This month: what came in, what went out and what's left, so far. Only what happened:
// no projection of the rest of the month (that's the full app's monthProjection.js).
function renderThisMonthTotals(monthTotals, currentMonth) {
  const transactionsThisMonth = appState.transactions.filter((transaction) => transaction.date.startsWith(currentMonth));
  const countOfType = (type) => transactionsThisMonth.filter((transaction) => transaction.type === type).length;
  const saved = monthTotals.income - monthTotals.expense;
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  elementById("light-month-income").textContent = euroFormatter.format(monthTotals.income);
  elementById("light-month-income-detail").textContent = countOfType("income") ? `${formatCount(countOfType("income"), "payment")} in` : "nothing in yet";
  elementById("light-month-spent").textContent = euroFormatter.format(monthTotals.expense);
  elementById("light-month-spent-detail").textContent = `${formatCount(countOfType("expense"), "expense")} · day ${today.getDate()} of ${daysInMonth}`;
  const savedElement = elementById("light-month-saved");
  savedElement.textContent = euroFormatter.format(saved);
  savedElement.classList.toggle("neg", saved < 0);
  elementById("light-month-saved-detail").textContent = monthTotals.income > 0
    ? `${formatSavingsRate(monthTotals)} of what came in`
    : "income minus spending";
}
