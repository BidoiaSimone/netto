// ---- Investments page: summary cards, allocation and gain bars, holdings table, trades table ----
// (The price history chart is in investmentPriceHistoryChart.js, the buy / sell dialog in dialogs/tradeDialog.js.)

import { elementById, createElement, fillTableBody, createTypeBadge, makeTableRowsOpenItems } from "../core/domHelpers.js";
import {
  euroFormatter, wholeEuroFormatter, shareCountFormatter, pricePerShareFormatter,
  formatSignedEuros, formatSignedWholeEuros, formatSignedPercent, animateEuroAmount,
} from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { drawHorizontalBarChart } from "../charts/horizontalBarChart.js";
import { loadPriceHistoryIfChanged } from "./investmentPriceHistoryChart.js";
import { openTradeDialog } from "../dialogs/tradeDialog.js";

export async function loadInvestments() {
  const [holdings] = await Promise.all([callApi("/investments"), loadTrades()]);
  appState.holdings = holdings;
  fillTableBody("investments-body", holdings, createHoldingRowCells);
  const tradedTickers = [...new Set(appState.trades.map((trade) => trade.ticker))];
  elementById("ticker-list").replaceChildren(...tradedTickers.map((ticker) => new Option(ticker))); // suggestions in the trade dialog
  renderInvestmentSummary(holdings);
  loadPriceHistoryIfChanged(holdings);
}

// A holding whose live price couldn't be fetched has a price_error and no value / gain
const hasLivePrice = (holding) => !holding.price_error;

function createHoldingRowCells(holding) {
  const buyAndSellButtons = createElement("div", "row-actions");
  for (const side of ["buy", "sell"]) {
    const button = createElement("button", "ghost", side === "buy" ? "Buy" : "Sell");
    button.type = "button";
    button.onclick = () => openTradeDialog({ side, ticker: holding.ticker });
    buyAndSellButtons.append(button);
  }
  const isLive = hasLivePrice(holding);
  const gainColorClass = holding.gain >= 0 ? "pos" : "neg";
  return [
    holding.ticker,
    shareCountFormatter.format(holding.shares),
    pricePerShareFormatter.format(holding.average_purchase_price),
    euroFormatter.format(holding.amount_invested),
    isLive ? euroFormatter.format(holding.current_value) : "n/a",
    isLive ? createElement("span", gainColorClass, euroFormatter.format(holding.gain)) : "n/a",
    isLive && holding.gain_pct != null ? createElement("span", gainColorClass, holding.gain_pct.toFixed(2) + "%") : "n/a",
    buyAndSellButtons,
  ];
}

function renderInvestmentSummary(holdings) {
  const liveHoldings = holdings.filter(hasLivePrice);
  const sumOf = (list, field) => list.reduce((sum, holding) => sum + holding[field], 0);
  const totalInvested = sumOf(holdings, "amount_invested");
  const totalValue = sumOf(liveHoldings, "current_value");
  const totalGain = sumOf(liveHoldings, "gain");
  const investedInLiveHoldings = sumOf(liveHoldings, "amount_invested");

  animateEuroAmount(elementById("inv-value"), totalValue);
  animateEuroAmount(elementById("inv-invested"), totalInvested);
  const gainElement = elementById("inv-gain");
  gainElement.textContent = formatSignedEuros(totalGain);
  gainElement.className = totalGain >= 0 ? "pos" : "neg";
  const gainPercentElement = elementById("inv-gain-pct");
  gainPercentElement.textContent = investedInLiveHoldings ? formatSignedPercent((totalGain / investedInLiveHoldings) * 100) : "";
  gainPercentElement.className = totalGain >= 0 ? "pos" : "neg";
  // gains already cashed in by selling are not in the gain above (that's on shares still held)
  const totalRealizedGain = appState.trades.reduce((sum, trade) => sum + (trade.realized_gain ?? 0), 0);
  if (totalRealizedGain) gainPercentElement.textContent += `${gainPercentElement.textContent ? " · " : ""}${formatSignedEuros(totalRealizedGain)} realized from sales`;

  // Allocation: share of current value, biggest first
  const holdingsWithValue = liveHoldings.filter((holding) => holding.current_value > 0).sort((first, second) => second.current_value - first.current_value);
  drawHorizontalBarChart("inv-alloc", holdingsWithValue.map((holding) => ({
    name: holding.ticker, value: holding.current_value, colorClass: "share",
    label: `${((holding.current_value / totalValue) * 100).toFixed(1)}% · ${wholeEuroFormatter.format(holding.current_value)}`,
  })));

  drawHorizontalBarChart("inv-gains", liveHoldings.map((holding) => ({
    name: holding.ticker, value: holding.gain, label: `${formatSignedWholeEuros(holding.gain)} · ${formatSignedPercent(holding.gain_pct ?? 0)}`,
  })));
}

// Every buy and sell, newest first. Clicking one opens it in the trade dialog.
async function loadTrades() {
  appState.trades = await callApi("/investments/trades");
  fillTableBody("trades-body", appState.trades, (trade) => [
    trade.date,
    createTypeBadge(trade.side),
    trade.ticker,
    shareCountFormatter.format(trade.shares),
    pricePerShareFormatter.format(trade.price),
    trade.fees ? euroFormatter.format(trade.fees) : "",
    (trade.side === "buy" ? "−" : "+") + euroFormatter.format(trade.amount),
    trade.account ?? (trade.note?.startsWith("Opening position") ? "opening position" : "not tracked"),
    trade.realized_gain == null ? "" : createElement("span", trade.realized_gain >= 0 ? "pos" : "neg", formatSignedEuros(trade.realized_gain)),
  ]);
  makeTableRowsOpenItems("trades-body", appState.trades,
    (trade) => openTradeDialog(trade, { isEditing: true }),
    (trade) => (trade.note ? `${trade.note} · click to edit` : "Click to edit"));
}
