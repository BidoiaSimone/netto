// ---- Statements page: your three financial statements for a period (GET /statements) ----
//   net worth bridge   how the net worth at the start became the one at the end (waterfall chart)
//   income statement   income and expenses by category, net savings, savings rate
//   money flows        the same income and expenses as a Sankey diagram, with investments and savings (moneyFlows.js)
//   balance sheet      every account and investment at the start and at the end, by liquidity class
//   budget vs actual   each budgeted category's limit over the period (prorated by days) against what was spent
//   investment returns money-weighted (XIRR) and time-weighted, per ticker and in total
//   estimated taxes    Italian taxes for the period and the deferred tax on the balance sheet: ESTIMATES shown next
//                      to the statements, never inside their totals (the server keeps them apart too)
// The period is picked with the chips (this month, last month...) or by changing the two dates (= custom);
// the choice is remembered.

import { elementById, createElement, fillTableBody, highlightSelectedChip } from "../core/domHelpers.js";
import { euroFormatter, formatSignedEuros, formatShortDate, getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { LIQUIDITY_CLASSES, getAccountKindLabel } from "../core/accountKinds.js";
import { drawWaterfallChart } from "../charts/waterfallChart.js";
import { renderMoneyFlows } from "./moneyFlows.js";

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

// Budget vs actual: one row per category that had a budget in the period, then unbudgeted spending and the total
function renderBudgetVsActual(budgetVsActual) {
  const hasBudgets = budgetVsActual.rows.length > 0;
  elementById("st-budget-table").hidden = !hasBudgets;
  elementById("st-budget-empty").hidden = hasBudgets;
  const createDifferenceCell = (difference) =>
    createElement("span", difference < 0 ? "neg" : "", difference < 0 ? `${euroFormatter.format(-difference)} over` : `${euroFormatter.format(difference)} left`);
  const createUsedCell = (shareUsed) => {
    const usedCell = createElement("span", "st-budget-used");
    const track = createElement("span", "st-budget-track");
    const fill = createElement("span", shareUsed > 1 ? "over" : shareUsed >= 0.8 ? "near" : "");
    fill.style.width = `${Math.min(shareUsed ?? 0, 1) * 100}%`;
    track.append(fill);
    usedCell.append(track, shareUsed === null ? "—" : percentFormatter.format(shareUsed));
    return usedCell;
  };

  fillTableBody("st-budget-body", budgetVsActual.rows, (row) => {
    const nameCell = createElement("span", "st-item", row.name);
    // a category budgeted for only part of the period says for how much of it
    if (row.budgeted_months < budgetVsActual.months) nameCell.append(createElement("small", "hint", `budget for ${row.budgeted_months.toLocaleString("it-IT")} of ${budgetVsActual.months.toLocaleString("it-IT")} months`));
    return [nameCell, euroFormatter.format(row.budget), euroFormatter.format(row.actual), createDifferenceCell(row.difference), createUsedCell(row.share_used)];
  });

  const footer = elementById("st-budget-foot");
  footer.replaceChildren();
  const addFooterRow = (cells, className) => {
    const tableRow = document.createElement("tr");
    if (className) tableRow.className = className;
    for (const cell of cells) {
      const tableCell = document.createElement("td");
      tableCell.append(cell ?? "");
      tableRow.append(tableCell);
    }
    footer.append(tableRow);
  };
  addFooterRow(["Total budgeted", euroFormatter.format(budgetVsActual.total_budget), euroFormatter.format(budgetVsActual.total_actual),
    createDifferenceCell(budgetVsActual.total_difference), createUsedCell(budgetVsActual.total_budget > 0 ? budgetVsActual.total_actual / budgetVsActual.total_budget : null)]);
  addFooterRow(["Unbudgeted spending", "—", euroFormatter.format(budgetVsActual.unbudgeted_actual), "", ""], "st-budget-unbudgeted");

  const monthsText = budgetVsActual.months.toLocaleString("it-IT");
  elementById("st-budget-note").textContent = hasBudgets
    ? `Budget = each month's limit × the part of that month in the period (${monthsText} months here): 10 days of a 31-day month count 10/31 of its limit. Actual = expenses, recurring ones included, in the months a category had a budget; the rest is unbudgeted.`
    : "";
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
  // the tax estimates come after the real total, marked as estimates, so they can't be mistaken for part of it
  const afterTax = statements.tax_estimates.balance_sheet;
  const asDeduction = (tax) => (tax ? -tax : 0); // 0, not −0 (which would show as "−0,00 €")
  rows.push({ isEstimate: true, name: "Deferred tax on unrealized gains", opening: asDeduction(afterTax.deferred_tax_opening), closing: asDeduction(afterTax.deferred_tax_closing) });
  rows.push({ isEstimate: true, isTotal: true, name: "Net worth after tax", opening: afterTax.net_worth_after_tax_opening, closing: afterTax.net_worth_after_tax_closing });

  fillTableBody("st-balance-body", rows, (row) => {
    let nameCell;
    if (row.isClass) {
      nameCell = createElement("span", "liq-class");
      nameCell.append(createElement("i", `swatch liq-${row.key}`), row.name);
    } else if (row.isEstimate) {
      nameCell = createElement(row.isTotal ? "strong" : "span", "", row.name);
      nameCell.append(createElement("span", "estimate-badge", "estimate"));
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
    tableRow.classList.toggle("st-estimate-row", Boolean(rows[index].isEstimate));
  });

  const taxedHoldings = afterTax.holdings.filter((holding) => holding.tax > 0).map((holding) => `${holding.ticker} ${euroFormatter.format(holding.tax)}`);
  elementById("st-deferred-tax-note").textContent = `Deferred tax: what selling everything on the last day would cost, `
    + `${percentFormatter.format(statements.tax_estimates.rates.capital_gains)} of each holding's gain over its average cost`
    + `${taxedHoldings.length ? ` (${taxedHoldings.join(", ")})` : ""}. Gains on ETFs like EIMI, SWDA and VWCE are "redditi di capitale": `
    + `each is taxed on its own, and a loss on one ETF can't reduce the tax on another (shown here, not offset).`;
}

// ---------- investment returns ----------

// A return as the page shows it: the period's own return first, the yearly one under it (or the other way round
// for a year or more). Annualizing a few weeks gives silly numbers (+36% in a month is "+7.691.558% a year"),
// so for short periods the yearly number isn't shown at all: printing it, even with a warning, invites reading it.
const SHORTEST_PERIOD_WORTH_ANNUALIZING_IN_DAYS = 90;
function describeReturn(returnOfPeriod, days) {
  if (!returnOfPeriod) return { main: "—", detail: "" };
  const periodText = formatSignedPercentage(returnOfPeriod.period);
  const annualText = returnOfPeriod.annual === null ? "—" : formatSignedPercentage(returnOfPeriod.annual);
  if (days >= 365) return { main: `${annualText} a year`, detail: `${periodText} over the whole period` };
  if (days < SHORTEST_PERIOD_WORTH_ANNUALIZING_IN_DAYS) return { main: periodText, detail: "too short to annualize" };
  return { main: periodText, detail: `≈ ${annualText} a year` };
}
const signedPercentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero" });
const formatSignedPercentage = (fraction) => signedPercentFormatter.format(fraction);

function createReturnCell(returnOfPeriod, days) {
  const { main, detail } = describeReturn(returnOfPeriod, days);
  const cell = createElement("span", returnOfPeriod ? (returnOfPeriod.period > 0 ? "pos" : returnOfPeriod.period < 0 ? "neg" : "") : "", main);
  if (detail) cell.append(createElement("small", "st-return-detail", detail));
  return cell;
}

function renderInvestmentReturns(investmentReturns, failedTickers) {
  const { days, tickers, total } = investmentReturns;
  const hasInvestments = tickers.length > 0;
  elementById("st-returns-table").hidden = !hasInvestments;
  elementById("st-returns-empty").hidden = hasInvestments;

  const gainElement = elementById("st-return-gain");
  gainElement.textContent = formatSignedEuros(total.gain);
  gainElement.className = total.gain > 0 ? "pos" : total.gain < 0 ? "neg" : "";
  elementById("st-return-gain-detail").textContent = `${euroFormatter.format(total.opening)} at the start, ${euroFormatter.format(total.bought)} bought, ${euroFormatter.format(total.sold)} sold, ${euroFormatter.format(total.closing)} at the end`;
  for (const [elementId, returnOfPeriod] of [["st-return-mwr", total.money_weighted], ["st-return-twr", total.time_weighted]]) {
    const { main, detail } = describeReturn(returnOfPeriod, days);
    elementById(elementId).textContent = main;
    elementById(`${elementId}-detail`).textContent = detail;
  }

  const rows = [...tickers, { ticker: "Total", isTotal: true, ...total }];
  fillTableBody("st-returns-body", rows, (row) => [
    row.isTotal ? createElement("strong", "", row.ticker) : row.ticker,
    euroFormatter.format(row.opening), euroFormatter.format(row.bought), euroFormatter.format(row.sold), euroFormatter.format(row.closing),
    createElement("span", row.gain > 0 ? "pos" : row.gain < 0 ? "neg" : "", formatSignedEuros(row.gain)),
    createReturnCell(row.money_weighted, days),
    createReturnCell(row.time_weighted, days),
  ]);
  [...elementById("st-returns-body").rows].forEach((tableRow, index) => tableRow.classList.toggle("st-total-row", Boolean(rows[index].isTotal)));

  const valuedAtCost = tickers.filter((ticker) => ticker.valued_at_cost).map((ticker) => ticker.ticker);
  elementById("st-returns-note").textContent = valuedAtCost.length || failedTickers.length
    ? `No price history for ${[...new Set([...valuedAtCost, ...failedTickers])].join(", ")}: valued at cost, so its return shows as about 0.`
    : "";
}

// ---------- estimated taxes ----------

function renderTaxEstimates(taxEstimates) {
  const { period, rates, days } = taxEstimates;
  const daysText = `${days}/365 of a year`;
  const rows = [
    { name: "Imposta di bollo, securities", basis: `${percentFormatter.format(rates.stamp_duty_on_securities_per_year)} a year × ${euroFormatter.format(period.securities_value_at_end)} at the end × ${daysText}`, amount: period.stamp_duty_on_securities },
    ...period.current_accounts.map((account) => ({
      name: `Imposta di bollo, ${account.name}`,
      basis: account.stamp_duty > 0
        ? `average balance ${euroFormatter.format(account.average_balance)} (over ${euroFormatter.format(rates.stamp_duty_threshold)}): ${euroFormatter.format(rates.stamp_duty_on_current_accounts_per_year)} a year × ${daysText}`
        : `average balance ${euroFormatter.format(account.average_balance)}: not over ${euroFormatter.format(rates.stamp_duty_threshold)}, nothing due`,
      amount: account.stamp_duty,
    })),
    ...period.sells.map((sell) => ({
      name: `Capital gains tax, ${sell.ticker} sold ${formatShortDate(sell.date, true)}`,
      basis: sell.gain > 0 ? `${percentFormatter.format(rates.capital_gains)} × gain ${euroFormatter.format(sell.gain)}` : `a loss of ${euroFormatter.format(-sell.gain)}: no tax`,
      amount: sell.tax,
    })),
  ];
  fillTableBody("st-taxes-body", rows, (row) => [row.name, createElement("span", "hint", row.basis), euroFormatter.format(row.amount)]);
  elementById("st-taxes-total").textContent = euroFormatter.format(period.total);
  elementById("st-taxes-note").textContent = "Estimates next to the statements, not inside them: netto doesn't record what Directa or the bank "
    + "actually withheld, so the totals above and the bridge only contain what you recorded. The 5.000 € threshold is checked for each "
    + "current account on its own: the law adds up all current accounts at the same bank, and netto doesn't know which bank an account is at. "
    + "Savings accounts aren't included (a conto deposito pays 0,2% a year like securities, a libretto 34,20 € like a current account). "
    + `Rates checked on ${formatShortDate(rates.last_checked, true)}, in backend/config/italianTaxRates.js.`;
}

function renderStatementsPage(statements) {
  renderPeriodPicker(statements);
  renderBridge(statements.bridge, statements.failed_tickers);
  renderIncomeStatement(statements.income_statement);
  renderMoneyFlows(statements.money_flows);
  renderBalanceSheet(statements.balance_sheet, statements);
  renderBudgetVsActual(statements.budget_vs_actual);
  renderInvestmentReturns(statements.investment_returns, statements.failed_tickers);
  renderTaxEstimates(statements.tax_estimates);
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
