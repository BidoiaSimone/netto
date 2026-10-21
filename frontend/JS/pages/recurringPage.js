// ---- Recurring page: the recurring transactions (rent, salary, subscriptions...) and what they add up to ----
// On each date the server adds a normal transaction by itself (services/recurringTransactionPoster.js).

import { elementById, createElement, fillTableBody, createTypeBadge, makeTableRowsOpenItems } from "../core/domHelpers.js";
// single transactions stay readable with Hide amounts on (see core/formatting.js)
import { visibleEuroFormatter as euroFormatter, formatShortDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { describeRepeat, calculateMonthlyEquivalent } from "../core/recurrenceDates.js";
import { createSignedAmountCell, createTransactionIcon } from "../core/transactionDisplay.js";
import { openRecurringTransactionEditor } from "../dialogs/recurringTransactionDialog.js";
import { renderMonthProjection, sumRecurringStillDueThisMonth } from "./monthProjection.js";

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

// The name cell: the category's icon (Pocket only, 09-categories-page.css), then the description or the category
function createRuleNameCell(rule) {
  const label = createElement("span", "category-label");
  const icon = createTransactionIcon(rule);
  icon.className = "category-icon small" + (icon.classList.contains("uncategorized") ? " uncategorized" : "");
  label.append(icon, createElement("span", "category-label-text", rule.description || rule.category || "—"));
  return label;
}

export function renderRecurringPage() {
  const rules = sortBySoonestDate(appState.recurringTransactions);
  elementById("recurring-empty").hidden = rules.length > 0;
  fillTableBody("recurring-body", rules, (rule) => [
    createRuleNameCell(rule),
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

const formatSignedEuros = (amount) => `${amount >= 0 ? "+" : "−"}${euroFormatter.format(Math.abs(amount))}`;

// Two lines:
//   what the active rules mean per month, on average (a yearly 120 € counts as 10 € a month)
//   what is still to come before the end of this month (the same numbers Insights > This month uses)
function renderMonthlySummary() {
  const activeRules = appState.recurringTransactions.filter(isActive);
  const monthlyTotalOfType = (type) => activeRules.filter((rule) => rule.type === type).reduce((sum, rule) => sum + calculateMonthlyEquivalent(rule), 0);
  const summary = elementById("recurring-summary");
  if (!activeRules.length) {
    summary.replaceChildren();
    return;
  }
  const moneyIn = monthlyTotalOfType("income"), moneyOut = monthlyTotalOfType("expense");
  const stillDue = sumRecurringStillDueThisMonth();
  const monthName = new Date().toLocaleDateString("en-GB", { month: "long" });
  summary.replaceChildren(
    "Per month on average: ",
    createElement("span", "pos", `+${euroFormatter.format(moneyIn)} in`), " · ",
    createElement("span", "neg", `−${euroFormatter.format(moneyOut)} out`), " · ",
    createElement("strong", "", `${formatSignedEuros(moneyIn - moneyOut)} net`),
    createElement("br"),
    `Still due in ${monthName}: `,
    createElement("span", "pos", `+${euroFormatter.format(stillDue.income)} in`), " · ",
    createElement("span", "neg", `−${euroFormatter.format(stillDue.expense)} out`), " · ",
    createElement("strong", "", `${formatSignedEuros(stillDue.income - stillDue.expense)} net`),
  );
}