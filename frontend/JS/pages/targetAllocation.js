// ---- Investments > Target allocation (GET /investments/allocation, PUT /investments/targets) ----
// One row per fund: its value, its share now, the target you set (editable), and the drift between the two,
// highlighted when it's over the threshold (a setting). Under it, "I'm investing X €": how to split new money
// so the portfolio moves towards the targets WITHOUT selling anything (the maths: backend services/targetAllocation.js).
// "Record these trades" then opens the buy dialog for each fund in turn, already filled in.

import { elementById, createElement, fillTableBody } from "../core/domHelpers.js";
import { euroFormatter, formatSignedEuros, shareCountFormatter, pricePerShareFormatter } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { bindNumberInputToSetting } from "../core/appSettings.js";
import { openTradeDialogsOneAfterAnother } from "../dialogs/tradeDialog.js";

const NEW_MONEY_DELAY_MILLISECONDS = 300;
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pointsFormatter = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// +4,2 pt / −4,2 pt (a real minus sign, like the amounts)
const formatSignedPoints = (points) => `${points > 0.05 ? "+" : points < -0.05 ? "−" : ""}${pointsFormatter.format(Math.abs(points))} pt`;


let allocation = null;        // the server's last answer
let editedTargetByTicker = null; // ticker -> percent being typed, before "Save targets"; null = nothing changed
let newMoneyTimer = null;

export async function loadTargetAllocation() {
  const newMoney = Number(elementById("allocation-new-money").value);
  allocation = await callApi(`/investments/allocation${newMoney > 0 ? `?new_money=${newMoney}` : ""}`);
  renderTargetAllocation();
  // a missing live price is said once, quietly, at the top of Investments (homePage.js), not in the red line
}

// The targets as shown in the inputs: being edited, else the saved ones (percent)
function currentTargetPercentByTicker() {
  if (editedTargetByTicker) return editedTargetByTicker;
  return new Map(allocation.rows.filter((row) => row.target_share > 0).map((row) => [row.ticker, Math.round(row.target_share * 10000) / 100]));
}

function createTargetInput(row) {
  const input = createElement("input", "allocation-target-input");
  input.type = "number";
  input.min = "0";
  input.max = "100";
  input.step = "0.5";
  input.inputMode = "decimal";
  input.placeholder = "0";
  input.setAttribute("aria-label", `${row.ticker}: target %`);
  const percent = currentTargetPercentByTicker().get(row.ticker);
  input.value = percent ?? "";
  input.addEventListener("input", () => {
    editedTargetByTicker ??= new Map(currentTargetPercentByTicker());
    if (input.value === "" || Number(input.value) === 0) editedTargetByTicker.delete(row.ticker);
    else editedTargetByTicker.set(row.ticker, Number(input.value));
    renderTargetTotal();
  });
  const cell = createElement("span", "allocation-target-cell");
  cell.append(input, createElement("span", "allocation-percent-sign", "%"));
  return cell;
}

function createDriftCell(row, formattedValue) {
  const isOverThreshold = Math.abs(row.drift_points) >= allocation.drift_threshold_points;
  return createElement("span", isOverThreshold ? "allocation-drift over" : "allocation-drift", formattedValue);
}

function renderTargetAllocation() {
  if (!allocation) return;
  const isEditing = document.activeElement?.closest("#allocation-body, #allocation-add-ticker");
  if (!isEditing) {
    fillTableBody("allocation-body", allocation.rows, (row) => [
      row.ticker,
      row.value === null ? "n/a" : euroFormatter.format(row.value),
      row.current_share === null ? "n/a" : percentFormatter.format(row.current_share),
      createTargetInput(row),
      row.drift_points === null ? "n/a" : createDriftCell(row, formatSignedPoints(row.drift_points)),
      row.drift === null ? "n/a" : createDriftCell(row, formatSignedEuros(row.drift)),
    ]);
  }
  elementById("allocation-total-value").textContent = euroFormatter.format(allocation.total_value);
  elementById("allocation-empty").hidden = allocation.rows.length > 0;
  renderTargetTotal();
  bindNumberInputToSetting(elementById("allocation-threshold"), "allocation_drift_threshold_points", {
    onSaved: () => loadTargetAllocation().catch((error) => showAllocationError(error.message)),
    showError: showAllocationError,
  });
  renderNewMoneySplit();
}

// "Targets: 95% · 5% left to assign" and the Save button, which only works at exactly 100% (or 0%: no targets)
function renderTargetTotal() {
  const targetPercents = [...currentTargetPercentByTicker().values()];
  const totalPercent = Math.round(targetPercents.reduce((sum, percent) => sum + percent, 0) * 100) / 100;
  const totalCell = elementById("allocation-target-total");
  totalCell.textContent = `${totalPercent.toLocaleString("it-IT")}%`;
  totalCell.className = totalPercent === 100 || (totalPercent === 0 && !targetPercents.length) ? "" : "neg";
  const status = elementById("allocation-target-status");
  const saveButton = elementById("allocation-save");
  saveButton.hidden = !editedTargetByTicker;
  elementById("allocation-undo").hidden = !editedTargetByTicker;
  saveButton.disabled = !(totalPercent === 100 || targetPercents.length === 0);
  if (!editedTargetByTicker) status.textContent = allocation.targets_set ? "" : "No targets yet: type a % for each fund (they must add up to 100%).";
  else if (totalPercent === 100) status.textContent = "Adds up to 100%: save to use these targets.";
  else if (targetPercents.length === 0) status.textContent = "No targets: saving removes them all.";
  else status.textContent = totalPercent < 100 ? `${(100 - totalPercent).toLocaleString("it-IT")}% still to assign.` : `${(totalPercent - 100).toLocaleString("it-IT")}% too much.`;
}

// "I'm investing 500 €": one line per fund that gets money, with roughly how many shares that buys
function renderNewMoneySplit() {
  const buysList = elementById("allocation-buys");
  const recordButton = elementById("allocation-record");
  const split = allocation.split;
  const newMoney = Number(elementById("allocation-new-money").value);
  recordButton.hidden = true;
  if (!(newMoney > 0)) return buysList.replaceChildren();
  if (!allocation.targets_set) return buysList.replaceChildren(createElement("p", "hint small", "Set your targets above first."));
  if (!split) return buysList.replaceChildren(createElement("p", "hint small", "Can't work it out without a live price for every fund."));

  const buys = split.buys.filter((buy) => buy.amount > 0);
  buysList.replaceChildren(...buys.map((buy) => {
    const line = createElement("div", "allocation-buy");
    const sharesText = buy.approximate_shares === null ? ""
      : `≈ ${shareCountFormatter.format(Math.round(buy.approximate_shares * 100) / 100)} shares at ${pricePerShareFormatter.format(buy.price)}`
        + (buy.whole_shares !== null && buy.whole_shares !== Math.round(buy.approximate_shares * 100) / 100 ? ` (${buy.whole_shares} whole)` : "");
    const after = split.after.find((row) => row.ticker === buy.ticker);
    line.append(
      createElement("strong", "allocation-buy-ticker", buy.ticker),
      createElement("span", "allocation-buy-amount", euroFormatter.format(buy.amount)),
      createElement("span", "allocation-buy-detail", [sharesText, after ? `then ${percentFormatter.format(after.share)}` : ""].filter(Boolean).join(" · ")),
    );
    return line;
  }));
  const fundsLeftOut = split.buys.filter((buy) => buy.amount === 0).map((buy) => buy.ticker);
  if (fundsLeftOut.length) buysList.append(createElement("p", "hint small", `Nothing for ${fundsLeftOut.join(", ")}: already above where this money brings the others.`));
  recordButton.hidden = !buys.some((buy) => buy.price);
}

function showAllocationError(message) {
  elementById("allocation-error").textContent = message ?? "";
}

async function saveTargets() {
  const targets = [...currentTargetPercentByTicker()].map(([ticker, targetPercent]) => ({ ticker, target_percent: targetPercent }));
  try {
    await callApi("/investments/targets", { method: "PUT", body: { targets } });
  } catch (error) {
    return showAllocationError(error.message);
  }
  editedTargetByTicker = null;
  showAllocationError("");
  await loadTargetAllocation().catch((error) => showAllocationError(error.message));
}

// A fund you don't hold yet can get a target too (the next buys will then go to it)
function addTickerToTargets(event) {
  event.preventDefault();
  const tickerInput = elementById("allocation-add-ticker");
  const ticker = tickerInput.value.trim().toUpperCase();
  if (!ticker) return;
  if (!allocation.rows.some((row) => row.ticker === ticker)) {
    allocation.rows.push({ ticker, value: 0, current_share: 0, target_share: 0, drift_points: 0, drift: 0 });
  }
  tickerInput.value = "";
  tickerInput.blur();
  renderTargetAllocation();
  elementById("allocation-body").querySelector(`input[aria-label="${ticker}: target %"]`)?.focus();
}

// The buys, opened one after another in the trade dialog at today's price: whole shares (an ETF on Borsa Italiana
// trades in whole shares), or the fraction when the money doesn't buy even one. Change them to what you really got.
function recordTheseTrades() {
  const trades = allocation.split.buys
    .filter((buy) => buy.amount > 0 && buy.price)
    .map((buy) => ({
      side: "buy",
      ticker: buy.ticker,
      shares: buy.whole_shares >= 1 ? buy.whole_shares : Math.round(buy.approximate_shares * 10000) / 10000,
      price: Math.round(buy.price * 10000) / 10000,
    }));
  openTradeDialogsOneAfterAnother(trades);
}

export function initializeTargetAllocation() {
  elementById("allocation-save").addEventListener("click", saveTargets);
  elementById("allocation-undo").addEventListener("click", () => {
    editedTargetByTicker = null;
    showAllocationError("");
    loadTargetAllocation().catch((error) => showAllocationError(error.message));
  });
  elementById("allocation-add-form").addEventListener("submit", addTickerToTargets);
  elementById("allocation-new-money").addEventListener("input", () => {
    clearTimeout(newMoneyTimer);
    newMoneyTimer = setTimeout(() => loadTargetAllocation().catch((error) => showAllocationError(error.message)), NEW_MONEY_DELAY_MILLISECONDS);
  });
  elementById("allocation-record").addEventListener("click", recordTheseTrades);
}
