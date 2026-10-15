// ---- Home page: net worth and its three groups (liquid, investments, immobilized), accounts to check, latest transactions ----
// (The net worth in the sidebar is filled here too.)

import { elementById, fillTableBody, createTypeBadge } from "../core/domHelpers.js";
import { animateEuroAmount, euroFormatter } from "../core/formatting.js";
import { splitNetWorthIntoGroups, calculateBarWidths } from "../core/netWorthGroups.js";
import { callApi } from "../core/apiClient.js";
import { appState, isAccountOpen } from "../core/appState.js";
import { createSignedAmountCell } from "../core/transactionDisplay.js";
import { updateReconcileDifferences } from "./assetsPage.js";
import { makeRowsOpenTransactionEditor } from "../dialogs/transactionDialog.js";
import { renderLiquidityInsights } from "./liquidityInsights.js";

const DAYS_BEFORE_AN_ACCOUNT_NEEDS_CHECKING = 30; // an account not reconciled for this long is flagged
const NUMBER_OF_LATEST_TRANSACTIONS = 5;
const MILLISECONDS_PER_DAY = 864e5;

// May return a warning: tickers without a live price are left out of the net worth
export async function loadNetWorth() {
  const netWorth = await callApi("/net-worth");
  appState.netWorth = netWorth;
  for (const elementId of ["net-worth-value", "h-net"]) animateEuroAmount(elementById(elementId), netWorth.net_worth);
  renderNetWorthGroups(splitNetWorthIntoGroups(netWorth));
  updateReconcileDifferences(); // its summary shows the net worth after reconciling
  renderLiquidityInsights();    // Insights > Liquidity
  if (netWorth.failed_tickers?.length) {
    return `No live price for ${netWorth.failed_tickers.join(", ")}: not included in net worth`;
  }
}

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });

// The three cards (amount + what's in it + its share of the net worth) and the bar under them
function renderNetWorthGroups(groups) {
  const shareOfNetWorth = (amount) => (groups.netWorth > 0 ? `${percentFormatter.format(amount / groups.netWorth)} of net worth · ` : "");
  const cards = [
    ["h-liquid", groups.liquid, groups.restrictedPartOfLiquid
      ? `cash and bank accounts, incl. ${euroFormatter.format(groups.restrictedPartOfLiquid)} in vouchers`
      : "cash and bank accounts: spendable today"],
    ["h-inv", groups.investments, "ETFs and stocks at today's prices"],
    ["h-immobilized", groups.immobilized, "car and other things you use: money only once sold"],
  ];
  for (const [elementId, amount, whatIsInIt] of cards) {
    const amountElement = elementById(elementId);
    animateEuroAmount(amountElement, amount);
    amountElement.classList.toggle("neg", amount < 0); // e.g. an overdrawn current account
    elementById(`${elementId}-note`).textContent = shareOfNetWorth(amount) + whatIsInIt;
  }
  const barWidths = calculateBarWidths(groups);
  elementById("bar-liquid").style.width = barWidths.liquid + "%";
  elementById("bar-inv").style.width = barWidths.investments + "%";
  elementById("bar-immobilized").style.width = barWidths.immobilized + "%";
}

// "Not reconciled in 30+ days: Cash (2026-08-01), Safe (never)"
export function renderAccountsNeedingCheck() {
  const oldestAcceptableTime = Date.now() - DAYS_BEFORE_AN_ACCOUNT_NEEDS_CHECKING * MILLISECONDS_PER_DAY;
  const accountsNeedingCheck = appState.accounts.filter((account) =>
    isAccountOpen(account) && (!account.last_reconciled || Date.parse(account.last_reconciled) < oldestAcceptableTime));
  elementById("stale").textContent = accountsNeedingCheck.length
    ? `Not reconciled in ${DAYS_BEFORE_AN_ACCOUNT_NEEDS_CHECKING}+ days: ${accountsNeedingCheck.map((account) => `${account.name} (${account.last_reconciled ?? "never"})`).join(", ")}`
    : "";
}

export function renderLatestTransactions() {
  const latestTransactions = appState.transactions.slice(0, NUMBER_OF_LATEST_TRANSACTIONS);
  fillTableBody("recent-body", latestTransactions, (transaction) => [
    transaction.date, createTypeBadge(transaction.type), createSignedAmountCell(transaction), transaction.description ?? transaction.category,
  ]);
  makeRowsOpenTransactionEditor("recent-body", latestTransactions);
}
