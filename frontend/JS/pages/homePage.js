// ---- Home page: net worth and its three groups (liquid, investments, immobilized), latest transactions ----
// (The accounts due to be reconciled are drawn by reconciliationReminders.js.)
// (The net worth in the sidebar is filled here too.)

import { elementById, createElement, fillTableBody, createTypeBadge } from "../core/domHelpers.js";
import { animateEuroAmount, euroFormatter } from "../core/formatting.js";
import { splitNetWorthIntoGroups, calculateBarWidths } from "../core/netWorthGroups.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { createSignedAmountCell, createTransactionIcon, describeDay, describeMovementRoute } from "../core/transactionDisplay.js";
import { updateReconcileDifferences } from "./assetsPage.js";
import { makeRowsOpenTransactionEditor } from "../dialogs/transactionDialog.js";
import { renderLiquidityInsights } from "./liquidityInsights.js";

const NUMBER_OF_LATEST_TRANSACTIONS = 5;

// Tickers without a live price (no connection, Yahoo slow) are left out of the net worth. That's not an error, and
// it fixes itself: a grey note on Investments and on Home's Investments card says so, not the red line on every page.
export async function loadNetWorth() {
  const netWorth = await callApi("/net-worth");
  appState.netWorth = netWorth;
  for (const elementId of ["net-worth-value", "h-net"]) animateEuroAmount(elementById(elementId), netWorth.net_worth);
  renderNetWorthGroups(splitNetWorthIntoGroups(netWorth));
  updateReconcileDifferences(); // its summary shows the net worth after reconciling
  renderLiquidityInsights();    // Insights > Liquidity
  const failedTickers = netWorth.failed_tickers ?? [];
  const lastKnownNote = describeLastKnownPrices(netWorth.last_known_prices ?? []);
  const priceNote = elementById("inv-price-note");
  priceNote.hidden = !failedTickers.length && !lastKnownNote;
  priceNote.textContent = [
    failedTickers.length && `No price at all yet for ${failedTickers.join(", ")}: left out of the totals, the net worth and the target allocation until one comes.`,
    lastKnownNote && `${lastKnownNote[0].toUpperCase()}${lastKnownNote.slice(1)} (markets closed, or Yahoo not answering right now).`,
  ].filter(Boolean).join(" ");
  if (failedTickers.length) elementById("h-inv-note").append(createElement("span", "price-missing", ` · no price for ${failedTickers.join(", ")}`));
  else if (lastKnownNote) elementById("h-inv-note").append(createElement("span", "hint", ` · ${lastKnownNote}`));
}

// "last prices from ven 16 ott, 17:35" (or one per ticker when they differ): the values shown use them
function describeLastKnownPrices(lastKnownPrices) {
  if (!lastKnownPrices.length) return "";
  const format = (isoDate) => new Date(isoDate).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const moments = [...new Set(lastKnownPrices.map((item) => format(item.as_of).slice(0, 10)))];
  return moments.length === 1
    ? `last prices from ${format(lastKnownPrices[0].as_of)}`
    : `last prices: ${lastKnownPrices.map((item) => `${item.ticker} ${format(item.as_of)}`).join(", ")}`;
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

// Cells: 1 date, 2 type, 3 amount, 4 description (or the category; a movement's route, "Edenred → BBVA"); Pocket also draws 5 and 6 (Classic hides them,
// 10-editable-rows-and-accounts.css): the line under the title ("Food · Yesterday") and the category's round icon,
// so each row looks like one of the Transactions list.
export function renderLatestTransactions() {
  const latestTransactions = appState.transactions.slice(0, NUMBER_OF_LATEST_TRANSACTIONS);
  fillTableBody("recent-body", latestTransactions, (transaction) => [
    transaction.date, createTypeBadge(transaction.type), createSignedAmountCell(transaction), transaction.type === "movement" ? describeMovementRoute(transaction) : transaction.description ?? transaction.category,
    [transaction.type === "movement" ? transaction.description : transaction.description ? transaction.category : null, describeDay(transaction.date)].filter(Boolean).join(" · "),
    createTransactionIcon(transaction),
  ]);
  makeRowsOpenTransactionEditor("recent-body", latestTransactions);
}
