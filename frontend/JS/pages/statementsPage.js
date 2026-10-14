// ---- Statements page: your three financial statements for a period (GET /statements) ----
//   net worth bridge   how the net worth at the start became the one at the end (waterfall chart)
//   income statement   income and expenses by category, net savings, savings rate
//   balance sheet      every account and investment at the start and at the end, by liquidity class
// The period is picked with the chips (this month, last month...) or by changing the two dates (= custom);
// the choice is remembered.

import { elementById, createElement, fillTableBody, highlightSelectedChip } from "../core/domHelpers.js";
import { euroFormatter, formatSignedEuros, formatShortDate, getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { LIQUIDITY_CLASSES, getAccountKindLabel } from "../core/accountKinds.js";
import { drawWaterfallChart } from "../charts/waterfallChart.js";

const SAVED_PERIOD_KEY = "statementsPeriod";
const DEFAULT_PERIOD = "this-month";
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });

// Short names for the chart's bars (the table and tooltips use the full ones)
const SHORT_BRIDGE_LABELS = {
  income: "Income", expenses: "Expenses", investment_results: "Investments",
  reconciliations: "Reconciled", starting_balances: "Added",
};

let selectedPeriod = DEFAULT_PERIOD;
let customDates = { from: "", to: "" };

// ---------- periods ----------

const padTwoDigits = (number) => String(number).padStart(2, "0");
const formatDate = (year, month, day) => `${year}-${padTwoDigits(month)}-${padTwoDigits(day)}`;
const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// The dates of a named period: { from, to } (to = today for the periods still running)
function resolvePeriodDates(periodName) {
  const today = getTodayAsLocalDate();
  const [year, month] = today.split("-").map(Number);
  switch (periodName) {
    case "last-month": {
      const lastMonthYear = month === 1 ? year - 1 : year, lastMonth = month === 1 ? 12 : month - 1;
      return { from: formatDate(lastMonthYear, lastMonth, 1), to: formatDate(lastMonthYear, lastMonth, lastDayOfMonth(lastMonthYear, lastMonth)) };
    }
    case "this-quarter": return { from: formatDate(year, Math.floor((month - 1) / 3) * 3 + 1, 1), to: today };
    case "this-year": return { from: formatDate(year, 1, 1), to: today };
    case "last-12-months": {
      const start = new Date(Date.UTC(year - 1, month - 1, Number(today.slice(8)) + 1));
      return { from: start.toISOString().slice(0, 10), to: today };
    }
    case "all": return { from: "1970-01-01", to: today }; // the server starts from the first record anyway
    case "custom": return { from: customDates.from || today, to: customDates.to || today };
    default: return { from: formatDate(year, month, 1), to: today }; // this month
  }
}

function restoreSavedPeriod() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_PERIOD_KEY));
    if (saved?.period) selectedPeriod = saved.period;
    if (saved?.customDates) customDates = saved.customDates;
  } catch {}
}

function savePeriod() {
  try { localStorage.setItem(SAVED_PERIOD_KEY, JSON.stringify({ period: selectedPeriod, customDates })); } catch {}
}

// ---------- loading ----------

let latestRequestNumber = 0; // a slow answer for an old period must not overwrite a newer one

export async function loadStatements() {
  const { from, to } = resolvePeriodDates(selectedPeriod);
  const requestNumber = ++latestRequestNumber;
  const statements = await callApi(`/statements?from=${from}&to=${to}`);
  if (requestNumber !== latestRequestNumber) return;
  renderStatementsPage(statements);
}

function reloadStatements() {
  loadStatements().catch((error) => showErrorMessage(error.message));
}

// ---------- drawing ----------

function renderPeriodPicker(statements) {
  highlightSelectedChip(elementById("st-period"), selectedPeriod);
  elementById("st-from").value = statements.from;
  elementById("st-to").value = statements.to;
  elementById("st-period-summary").textContent =
    `${formatShortDate(statements.from, true)} – ${formatShortDate(statements.to, true)} · opening values are from the end of ${formatShortDate(statements.opening_day, true)}`;
}

function renderBridge(bridge, failedTickers) {
  const bars = [
    { label: "Start", amount: bridge.opening, isTotal: true },
    ...bridge.steps.filter((step) => step.amount !== 0 || step.key === "income" || step.key === "expenses")
      .map((step) => ({ label: SHORT_BRIDGE_LABELS[step.key] ?? step.label, amount: step.amount })),
    { label: "End", amount: bridge.closing, isTotal: true },
  ];
  drawWaterfallChart(elementById("st-bridge-chart"), bars, "How your net worth changed in the period");

  const change = bridge.closing - bridge.opening;
  elementById("st-bridge-summary").textContent =
    `${euroFormatter.format(bridge.opening)} → ${euroFormatter.format(bridge.closing)} (${formatSignedEuros(change)})`;

  fillTableBody("st-bridge-body", bridge.steps, (step) => {
    const amountCell = createElement("span", step.amount > 0 ? "pos" : step.amount < 0 ? "neg" : "", formatSignedEuros(step.amount));
    return [step.label, amountCell];
  });

  const notes = [];
  if (Math.abs(bridge.unexplained) >= 0.01) notes.push(`${formatSignedEuros(bridge.unexplained)} not explained by the steps above: this shouldn't happen, please report it.`);
  if (failedTickers.length) notes.push(`No price history for ${failedTickers.join(", ")}: valued at cost, so its market result shows as 0.`);
  elementById("st-bridge-note").textContent = notes.join(" ");
}

function renderIncomeStatement(incomeStatement) {
  const createRows = (rows, total) => (row) => [row.name, euroFormatter.format(row.total), percentFormatter.format(total ? row.total / total : 0)];
  fillTableBody("st-income-body", incomeStatement.income, createRows(incomeStatement.income, incomeStatement.total_income));
  fillTableBody("st-expenses-body", incomeStatement.expenses, createRows(incomeStatement.expenses, incomeStatement.total_expenses));
  elementById("st-income-total").textContent = euroFormatter.format(incomeStatement.total_income);
  elementById("st-expenses-total").textContent = euroFormatter.format(incomeStatement.total_expenses);

  const netSavings = elementById("st-net-savings");
  netSavings.textContent = formatSignedEuros(incomeStatement.net_savings);
  netSavings.className = incomeStatement.net_savings >= 0 ? "pos" : "neg";
  elementById("st-savings-rate").textContent = incomeStatement.savings_rate === null ? "—" : percentFormatter.format(incomeStatement.savings_rate);
}

function createChangeCell(opening, closing) {
  const change = closing - opening;
  return createElement("span", change > 0 ? "pos" : change < 0 ? "neg" : "", Math.abs(change) < 0.005 ? "—" : formatSignedEuros(change));
}

// One heading row per liquidity class (with its totals), then its accounts and investments
function renderBalanceSheet(balanceSheet, statements) {
  elementById("st-opening-head").textContent = formatShortDate(statements.opening_day, true);
  elementById("st-closing-head").textContent = formatShortDate(statements.to, true);

  const rows = [];
  for (const liquidityClass of balanceSheet.classes) {
    if (!liquidityClass.items.length) continue;
    rows.push({ isClass: true, ...liquidityClass, name: LIQUIDITY_CLASSES.find((known) => known.key === liquidityClass.key)?.label ?? liquidityClass.key });
    rows.push(...liquidityClass.items.map((item) => ({ ...item, classKey: liquidityClass.key })));
  }
  rows.push({ isTotal: true, name: "Net worth", opening: balanceSheet.opening, closing: balanceSheet.closing });

  fillTableBody("st-balance-body", rows, (row) => {
    let nameCell;
    if (row.isClass) {
      nameCell = createElement("span", "liq-class");
      nameCell.append(createElement("i", `swatch liq-${row.key}`), row.name);
    } else if (row.isTotal) {
      nameCell = createElement("strong", "", row.name);
    } else {
      nameCell = createElement("span", "st-item", row.name);
      nameCell.append(createElement("small", "hint", row.kind === "investment" ? "ETF / stock" : getAccountKindLabel(row.kind)));
    }
    return [nameCell, euroFormatter.format(row.opening), euroFormatter.format(row.closing), createChangeCell(row.opening, row.closing)];
  });
  [...elementById("st-balance-body").rows].forEach((tableRow, index) => {
    tableRow.classList.toggle("st-class-row", Boolean(rows[index].isClass));
    tableRow.classList.toggle("st-total-row", Boolean(rows[index].isTotal));
  });
}

function renderStatementsPage(statements) {
  renderPeriodPicker(statements);
  renderBridge(statements.bridge, statements.failed_tickers);
  renderIncomeStatement(statements.income_statement);
  renderBalanceSheet(statements.balance_sheet, statements);
}

// ---------- buttons ----------

export function initializeStatementsPage() {
  restoreSavedPeriod();
  elementById("st-period").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    selectedPeriod = chip.dataset.value;
    savePeriod();
    reloadStatements();
  });
  for (const dateInputId of ["st-from", "st-to"]) {
    elementById(dateInputId).addEventListener("change", () => {
      customDates = { from: elementById("st-from").value, to: elementById("st-to").value };
      selectedPeriod = "custom";
      savePeriod();
      reloadStatements();
    });
  }
}
