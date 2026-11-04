// ---- Insights page, "Liquidity": your net worth split by how quickly it can become money you spend ----
// Needs both the net worth (GET /net-worth, split by liquidity class on the server) and what a month usually
// costs (GET /insights/monthly-expenses), which load separately: both call renderLiquidityInsights(), and
// whichever finishes last draws the complete picture.

import { elementById, createElement, fillTableBody } from "../core/domHelpers.js";
import { euroFormatter } from "../core/formatting.js";
import { appState, isAccountOpen } from "../core/appState.js";
import { callApi } from "../core/apiClient.js";
import { ACCOUNT_KINDS, LIQUIDITY_CLASSES } from "../core/accountKinds.js";
import { t, tp, translateServerMessage } from "../core/i18n.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });
const monthsFormatter = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

// What a month usually costs, worked out on the server like the Forecast's starting point (services/forecast.js):
//   the average of the last complete months (up to 6), counting only months your records cover from the 1st,
//   or, with no complete month yet, this month projected to its end (habitual categories at the daily pace of the
//   days recorded, one-off ones as spent, recurring by their dates).
// Always what was really spent: budgets don't count here.
let monthlyExpenses = null; // { monthly_expenses, months_of_data, source }

export async function loadMonthlyExpenses() {
  monthlyExpenses = await callApi("/insights/monthly-expenses");
  renderLiquidityInsights();
}

// The open accounts of one class with money in them: "BBVA, BCC, Cash"
function listAccountsOfClass(liquidityClassKey) {
  if (liquidityClassKey === "investments") return t("ETFs and stocks on the Investments page");
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
    t("{invested} invested · {liquid} liquid ({share})", { invested: euroFormatter.format(invested), liquid: euroFormatter.format(liquid), share: percentFormatter.format(share(liquid, invested + liquid)) });
}

function renderLiquidNetWorthCard(netWorth, totals) {
  elementById("liq-net-worth").textContent = euroFormatter.format(netWorth.net_worth - totals.personal_use);
  elementById("liq-net-worth-detail").textContent = t("net worth without personal-use assets ({amount})", { amount: euroFormatter.format(totals.personal_use) });
}

function renderEmergencyFundCard(totals) {
  if (!monthlyExpenses) return; // not loaded yet
  const perMonth = monthlyExpenses.monthly_expenses;
  if (perMonth <= 0) {
    elementById("liq-months").textContent = "—";
    elementById("liq-months-detail").textContent = t("needs some expenses to compare with");
    return;
  }
  const monthsCovered = totals.cash_and_equivalents / perMonth;
  const count = monthlyExpenses.months_of_data;
  const basedOn = count === 0 ? t("this month projected to its end: rough until a whole month is recorded")
    : tp(count, "the average of the last complete month", "the average of the last {count} complete months");
  elementById("liq-months").textContent = t("{count} months", { count: monthsFormatter.format(monthsCovered) });
  elementById("liq-months-detail").textContent = t("cash & equivalents ÷ {amount} of expenses a month ({basedOn})", { amount: euroFormatter.format(perMonth), basedOn });
  elementById("liq-months-detail").title = translateServerMessage(monthlyExpenses.source);
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
    ? t("No live price for {tickers}: left out of Investments, so the shares above are off.", { tickers: netWorth.failed_tickers.join(", ") })
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
