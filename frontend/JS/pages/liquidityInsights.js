// ---- Insights page, "Liquidity": your net worth split by how quickly it can become money you spend ----
// Needs both the net worth (GET /net-worth, split by liquidity class on the server) and the transactions
// (for the monthly expenses), which load separately: both loaders call renderLiquidityInsights(), and
// whichever finishes last draws the complete picture.

import { elementById, createElement, fillTableBody } from "../core/domHelpers.js";
import { euroFormatter, getTodayAsLocalDate } from "../core/formatting.js";
import { appState, isAccountOpen } from "../core/appState.js";
import { ACCOUNT_KINDS, LIQUIDITY_CLASSES } from "../core/accountKinds.js";

const MONTHS_OF_EXPENSES_AVERAGED = 6; // the emergency fund compares with the average of up to this many past months

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });
const monthsFormatter = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

// Average monthly spending, from the complete months before this one (up to 6).
// With no complete month yet, this month so far is used (and the card says so).
function calculateAverageMonthlyExpenses() {
  const expensesByMonth = new Map(); // "2026-10" -> total
  for (const transaction of appState.transactions) {
    if (transaction.type !== "expense") continue;
    const month = transaction.date.slice(0, 7);
    expensesByMonth.set(month, (expensesByMonth.get(month) ?? 0) + transaction.amount);
  }
  const currentMonth = getTodayAsLocalDate().slice(0, 7);
  const completeMonths = [...expensesByMonth.keys()].filter((month) => month < currentMonth).sort().slice(-MONTHS_OF_EXPENSES_AVERAGED);
  const monthsUsed = completeMonths.length ? completeMonths : expensesByMonth.has(currentMonth) ? [currentMonth] : [];
  if (!monthsUsed.length) return null;
  const total = monthsUsed.reduce((sum, month) => sum + expensesByMonth.get(month), 0);
  return { average: total / monthsUsed.length, monthCount: monthsUsed.length, isThisMonthSoFar: !completeMonths.length };
}

// The open accounts of one class with money in them: "BBVA, BCC, Cash"
function listAccountsOfClass(liquidityClassKey) {
  if (liquidityClassKey === "investments") return "ETFs and stocks on the Investments page";
  const names = appState.accounts
    .filter((account) => isAccountOpen(account) && account.balance !== 0 && ACCOUNT_KINDS[account.kind]?.liquidity === liquidityClassKey)
    .map((account) => account.name);
  return names.length ? names.join(", ") : "—";
}

const share = (part, whole) => (whole > 0 ? part / whole : 0);

function renderInvestedVersusLiquidCard(totals) {
  const liquid = totals.cash_and_equivalents, invested = totals.investments;
  elementById("liq-invested-share").textContent = percentFormatter.format(share(invested, invested + liquid));
  elementById("liq-invested-detail").textContent =
    `${euroFormatter.format(invested)} invested · ${euroFormatter.format(liquid)} liquid (${percentFormatter.format(share(liquid, invested + liquid))})`;
}

function renderLiquidNetWorthCard(netWorth, totals) {
  elementById("liq-net-worth").textContent = euroFormatter.format(netWorth.net_worth - totals.personal_use);
  elementById("liq-net-worth-detail").textContent = `net worth without personal-use assets (${euroFormatter.format(totals.personal_use)})`;
}

function renderEmergencyFundCard(totals) {
  const monthlyExpenses = calculateAverageMonthlyExpenses();
  if (!monthlyExpenses || monthlyExpenses.average <= 0) {
    elementById("liq-months").textContent = "—";
    elementById("liq-months-detail").textContent = "needs some expenses to compare with";
    return;
  }
  const monthsCovered = totals.cash_and_equivalents / monthlyExpenses.average;
  const basedOn = monthlyExpenses.isThisMonthSoFar ? "this month so far" : `the average of the last ${monthlyExpenses.monthCount === 1 ? "month" : `${monthlyExpenses.monthCount} months`}`;
  elementById("liq-months").textContent = `${monthsFormatter.format(monthsCovered)} months`;
  elementById("liq-months-detail").textContent = `cash & equivalents ÷ ${euroFormatter.format(monthlyExpenses.average)} of expenses a month (${basedOn})`;
}

// The bar and the table: each class with its amount and its share of the net worth
function renderLiquidityBreakdown(netWorth, totals) {
  const positiveTotal = LIQUIDITY_CLASSES.reduce((sum, liquidityClass) => sum + Math.max(0, totals[liquidityClass.key]), 0);
  elementById("liq-bar").replaceChildren(...LIQUIDITY_CLASSES.map((liquidityClass) => {
    const segment = createElement("span", `liq-${liquidityClass.key}`);
    segment.style.width = `${share(Math.max(0, totals[liquidityClass.key]), positiveTotal) * 100}%`;
    segment.title = `${liquidityClass.label}: ${euroFormatter.format(totals[liquidityClass.key])}`;
    return segment;
  }));

  fillTableBody("liq-body", LIQUIDITY_CLASSES, (liquidityClass) => {
    const nameCell = createElement("span", "liq-class");
    nameCell.append(createElement("i", `swatch liq-${liquidityClass.key}`), liquidityClass.label);
    const contents = createElement("span", "liq-contents", listAccountsOfClass(liquidityClass.key));
    contents.append(createElement("small", "hint", liquidityClass.howLiquid));
    return [nameCell, contents, euroFormatter.format(totals[liquidityClass.key]), percentFormatter.format(share(totals[liquidityClass.key], netWorth.net_worth))];
  });

  elementById("liq-note").textContent = netWorth.failed_tickers?.length
    ? `No live price for ${netWorth.failed_tickers.join(", ")}: left out of Investments, so the shares above are off.`
    : "";
}

export function renderLiquidityInsights() {
  const netWorth = appState.netWorth;
  if (!netWorth?.by_liquidity) return; // not loaded yet (or an older server still running)
  const totals = netWorth.by_liquidity;
  renderInvestedVersusLiquidCard(totals);
  renderLiquidNetWorthCard(netWorth, totals);
  renderEmergencyFundCard(totals);
  renderLiquidityBreakdown(netWorth, totals);
}
