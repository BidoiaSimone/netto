// ---- Investments page: "How your funds are doing" (price line of one fund) and "Change over the period" bars ----

import { elementById, createElement, highlightSelectedChip } from "../core/domHelpers.js";
import { euroFormatter, formatSignedPercent, formatSignedWholeEuros } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { drawLineChart } from "../charts/lineChart.js";
import { drawHorizontalBarChart } from "../charts/horizontalBarChart.js";
import { readStored, writeStored } from "../core/deviceStorage.js";

const RANGE_LABELS = { "1m": "1 month", "6m": "6 months", "1y": "1 year", "5y": "5 years" };
const REDRAW_DELAY_AFTER_RESIZE_MILLISECONDS = 150;

let selectedRange = readStored("invRange") || "1y";
let selectedTicker = readStored("invTicker"); // which fund the line chart shows
let priceHistory = null;        // the last answer of GET /investments/history
let priceHistoryRequestKey = null; // what that answer was for: range + holdings

// History is slow (one download per ticker), so it is only fetched when the range or the holdings change
export async function loadPriceHistoryIfChanged(holdings, forceReload) {
  const requestKey = selectedRange + JSON.stringify(holdings.map((holding) => [holding.ticker, holding.shares, holding.amount_invested]));
  // nothing new to fetch: just redraw (Hide amounts may have changed how the amounts are written)
  if (!forceReload && requestKey === priceHistoryRequestKey) return priceHistory ? renderPriceHistory() : undefined;
  priceHistoryRequestKey = requestKey;
  highlightSelectedChip(elementById("inv-range"), selectedRange, "invRange");
  if (!holdings.length) {
    priceHistory = null;
    return renderPriceHistory();
  }

  elementById("inv-line").replaceChildren(createElement("p", "chart-empty", "Loading price history…"));
  try {
    const answer = await callApi(`/investments/history?range=${selectedRange}`);
    if (requestKey !== priceHistoryRequestKey) return; // the range changed while loading
    priceHistory = answer;
  } catch (error) {
    priceHistory = null;
    priceHistoryRequestKey = null; // retry on the next refresh
    elementById("inv-line").replaceChildren(createElement("p", "chart-empty", "Price history unavailable: " + error.message));
    return;
  }
  renderPriceHistory();
}

function renderTickerChips(fundsWithHistory) {
  elementById("inv-tickers").replaceChildren(...fundsWithHistory.map((fund) => {
    const chip = createElement("button", "ghost" + (fund.ticker === selectedTicker ? " active" : ""), fund.ticker);
    chip.type = "button";
    chip.onclick = () => {
      selectedTicker = fund.ticker;
      writeStored("invTicker", selectedTicker);
      renderPriceHistory();
    };
    return chip;
  }));
}

function renderPriceHistory() {
  elementById("inv-period-title").textContent = `Change over ${RANGE_LABELS[selectedRange]}`;
  const periodSummary = elementById("inv-period-summary");

  const fundsWithHistory = priceHistory?.holdings ?? [];
  if (!fundsWithHistory.some((fund) => fund.ticker === selectedTicker)) selectedTicker = fundsWithHistory[0]?.ticker ?? null;
  renderTickerChips(fundsWithHistory);

  const selectedFund = fundsWithHistory.find((fund) => fund.ticker === selectedTicker);
  if (!selectedFund || selectedFund.prices.length < 2) {
    periodSummary.textContent = priceHistory?.failed_tickers?.length ? `No price history for ${priceHistory.failed_tickers.join(", ")}` : "";
    const emptyMessage = priceHistory ? "Not enough price history for this range" : "Add an investment to see how it's doing";
    elementById("inv-line").replaceChildren(createElement("p", "chart-empty", emptyMessage));
    drawHorizontalBarChart("inv-period", []);
    return;
  }

  const latestPrice = selectedFund.prices[selectedFund.prices.length - 1];
  periodSummary.replaceChildren(createElement("strong", "", euroFormatter.format(latestPrice)),
    createElement("span", selectedFund.change_pct >= 0 ? "pos" : "neg", formatSignedPercent(selectedFund.change_pct)),
    document.createTextNode(` over ${RANGE_LABELS[selectedRange]}`));
  if (priceHistory.failed_tickers.length) periodSummary.append(document.createTextNode(` · no history for ${priceHistory.failed_tickers.join(", ")}`));

  drawLineChart(elementById("inv-line"), selectedFund.dates, selectedFund.prices, selectedFund.average_purchase_price, "Your avg price");
  drawHorizontalBarChart("inv-period", fundsWithHistory.map((fund) => ({
    name: fund.ticker, value: fund.change_pct, label: `${formatSignedPercent(fund.change_pct)} · ${formatSignedWholeEuros(fund.change)}`,
  })));
}

export function initializePriceHistoryChart() {
  document.querySelectorAll("[data-inv-range]").forEach((chip) => chip.addEventListener("click", () => {
    selectedRange = chip.dataset.invRange;
    writeStored("invRange", selectedRange);
    loadPriceHistoryIfChanged(appState.holdings);
  }));

  // The line chart is drawn at the real pixel size, so redraw it when the window (or the page) changes size
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => priceHistory && renderPriceHistory(), REDRAW_DELAY_AFTER_RESIZE_MILLISECONDS);
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#investments" && priceHistory) setTimeout(renderPriceHistory); });
}
