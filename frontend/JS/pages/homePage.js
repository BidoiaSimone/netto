// ---- Home page: net worth cards, assets / investments bar, accounts to check, latest transactions ----
// (The net worth in the sidebar is filled here too.)

import { elementById, fillTableBody, createTypeBadge } from "../core/domHelpers.js";
import { animateEuroAmount } from "../core/formatting.js";
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
  animateEuroAmount(elementById("h-acc"), netWorth.accounts_value);
  animateEuroAmount(elementById("h-inv"), netWorth.investments_value);
  drawAssetsVersusInvestmentsBar(netWorth);
  updateReconcileDifferences(); // its summary shows the net worth after reconciling
  renderLiquidityInsights();    // Insights > Liquidity
  if (netWorth.failed_tickers?.length) {
    return `No live price for ${netWorth.failed_tickers.join(", ")}: not included in net worth`;
  }
}

function drawAssetsVersusInvestmentsBar(netWorth) {
  const accountsPart = Math.max(0, netWorth.accounts_value);
  const investmentsPart = Math.max(0, netWorth.investments_value);
  const total = accountsPart + investmentsPart;
  elementById("bar-acc").style.width = total ? (accountsPart / total) * 100 + "%" : "0%";
  elementById("bar-inv").style.width = total ? (investmentsPart / total) * 100 + "%" : "0%";
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
