// ---- Recurring page: the recurring transactions (rent, salary, subscriptions...) and what they add up to ----
// On each date the server adds a normal transaction by itself (services/recurringTransactionPoster.js).

import { elementById, createElement, fillTableBody, createTypeBadge, makeTableRowsOpenItems } from "../core/domHelpers.js";
import { euroFormatter, formatShortDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { describeRepeat, calculateMonthlyEquivalent } from "../core/recurrenceDates.js";
import { createSignedAmountCell } from "../core/transactionDisplay.js";
import { openRecurringTransactionEditor } from "../dialogs/recurringTransactionDialog.js";
import { renderMonthProjection } from "./monthProjection.js";

export async function loadRecurringTransactions() {
  appState.recurringTransactions = await callApi("/recurring-transactions");
  renderRecurringPage();
  renderMonthProjection(); // Insights > This month counts the recurring transactions still due
}

// Still adding transactions: not paused, not ended, not blocked by a closed account
const isActive = (rule) => !rule.paused && rule.next_date !== null && !rule.blocked_reason;

// Active rules first, soonest date first; ended ones last
function sortBySoonestDate(rules) {
  const sortKey = (rule) => `${isActive(rule) ? 0 : 1}${rule.next_date ?? "9999"}`;
  return [...rules].sort((first, second) => (sortKey(first) < sortKey(second) ? -1 : sortKey(first) > sortKey(second) ? 1 : 0));
}

// "BBVA", "→ BCC", "BBVA → BCC"
const describeAccounts = (rule) =>
  rule.type === "movement" ? `${rule.from_account} → ${rule.to_account}` : rule.from_account ?? rule.to_account;

// The "Next" column: the date, or why there is none
function createNextDateCell(rule) {
  if (rule.next_date === null) return createElement("span", "muted", "ended");
  if (rule.paused) return createElement("span", "status-pill", "paused");
  if (rule.blocked_reason) return createElement("span", "status-pill warn", `stopped: ${rule.blocked_reason}`);
  return formatShortDate(rule.next_date, true);
}

function renderRecurringPage() {
  const rules = sortBySoonestDate(appState.recurringTransactions);
  elementById("recurring-empty").hidden = rules.length > 0;
  fillTableBody("recurring-body", rules, (rule) => [
    rule.description || rule.category || "—",
    createTypeBadge(rule.type),
    createSignedAmountCell(rule),
    describeAccounts(rule),
    describeRepeat(rule),
    createNextDateCell(rule),
  ]);
  [...elementById("recurring-body").rows].forEach((tableRow, index) => tableRow.classList.toggle("inactive", !isActive(rules[index])));
  makeTableRowsOpenItems("recurring-body", rules, openRecurringTransactionEditor);
  renderMonthlySummary();
}

// What the active rules mean per month, on average (a yearly 120 € counts as 10 € a month)
function renderMonthlySummary() {
  const activeRules = appState.recurringTransactions.filter(isActive);
  const monthlyTotalOfType = (type) => activeRules.filter((rule) => rule.type === type).reduce((sum, rule) => sum + calculateMonthlyEquivalent(rule), 0);
  const summary = elementById("recurring-summary");
  if (!activeRules.length) {
    summary.replaceChildren();
    return;
  }
  const moneyIn = monthlyTotalOfType("income"), moneyOut = monthlyTotalOfType("expense");
  summary.replaceChildren("Per month on average: ",
    createElement("span", "pos", `+${euroFormatter.format(moneyIn)} in`), " · ",
    createElement("span", "neg", `−${euroFormatter.format(moneyOut)} out`), " · ",
    createElement("strong", "", `${moneyIn - moneyOut >= 0 ? "+" : "−"}${euroFormatter.format(Math.abs(moneyIn - moneyOut))} left`));
}
