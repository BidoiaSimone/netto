// ---- Insights page: net worth over time (accounts + investments, stacked) ----
// The server rebuilds the history from the transactions and trades (services/netWorthHistory.js).

import { elementById, createElement, highlightSelectedChip } from "../core/domHelpers.js";
import { euroFormatter, formatSignedEuros, formatSignedPercent, formatShortDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { drawStackedAreaChart } from "../charts/stackedAreaChart.js";

const REDRAW_DELAY_AFTER_RESIZE_MILLISECONDS = 150;

let selectedRange = localStorage.getItem("netWorthRange") || "1y";
let netWorthHistory = null; // the last answer of GET /net-worth/history

export async function loadNetWorthHistory() {
  highlightSelectedChip(elementById("nw-range"), selectedRange);
  const requestedRange = selectedRange;
  const answer = await callApi(`/net-worth/history?range=${requestedRange}`);
  if (requestedRange !== selectedRange) return; // the range changed while loading
  netWorthHistory = answer;
  renderNetWorthHistory();
}

// "55.573,26 €  +1.234,00 € (+2.3%) since 5 ott 26" (the first day shown: the range start, or your first record)
function renderPeriodSummary() {
  const summary = elementById("nw-summary");
  const values = netWorthHistory.net_worth;
  const firstValue = values[0], lastValue = values[values.length - 1];
  const change = lastValue - firstValue;
  const changeText = firstValue > 0 ? `${formatSignedEuros(change)} (${formatSignedPercent((change / firstValue) * 100)})` : formatSignedEuros(change);
  summary.replaceChildren(createElement("strong", "", euroFormatter.format(lastValue)),
    createElement("span", change >= 0 ? "pos" : "neg", changeText),
    document.createTextNode(` since ${formatShortDate(netWorthHistory.dates[0], true)}`));
}

function renderNetWorthHistory() {
  if (!netWorthHistory) return;
  const chartBox = elementById("nw-chart");
  const failedTickers = netWorthHistory.failed_tickers;
  elementById("nw-note").textContent = failedTickers.length
    ? `No price history for ${failedTickers.join(", ")}: valued at what you paid for it.`
    : "";

  if (netWorthHistory.dates.length < 2) {
    elementById("nw-summary").replaceChildren();
    chartBox.replaceChildren(createElement("p", "chart-empty", "Not enough history yet: the chart starts from your first record, come back tomorrow"));
    return;
  }
  renderPeriodSummary();
  drawStackedAreaChart(chartBox, netWorthHistory.dates, [
    { name: "Accounts", values: netWorthHistory.accounts, className: "accounts" },
    { name: "Investments", values: netWorthHistory.investments, className: "investments" },
  ], "Net worth");
}

export function initializeNetWorthHistoryChart() {
  elementById("nw-range").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    selectedRange = chip.dataset.value;
    localStorage.setItem("netWorthRange", selectedRange);
    elementById("nw-chart").replaceChildren(createElement("p", "chart-empty", "Loading…"));
    loadNetWorthHistory().catch((error) => {
      elementById("nw-chart").replaceChildren(createElement("p", "chart-empty", "Net worth history unavailable: " + error.message));
    });
  });

  // The chart is drawn at the real pixel size, so redraw it when the window (or the page) changes size
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderNetWorthHistory, REDRAW_DELAY_AFTER_RESIZE_MILLISECONDS);
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#insights") setTimeout(renderNetWorthHistory); });
}
