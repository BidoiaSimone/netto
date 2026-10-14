// ---- Transactions page: the full list with its filters (all client-side, so they apply instantly) ----

import { elementById, fillTableBody, createTypeBadge } from "../core/domHelpers.js";
import { euroFormatter, getTodayAsLocalDate, getLocalDateDaysFromToday } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { createSignedAmountCell, createDescriptionCell } from "../core/transactionDisplay.js";
import { renderLatestTransactions } from "./homePage.js";
import { renderInsightsPage } from "./insightsPage.js";
import { makeRowsOpenTransactionEditor } from "../dialogs/transactionDialog.js";
import { UNCATEGORIZED_FILTER_VALUE } from "../core/categoryPickers.js";


export async function loadTransactions() {
  appState.transactions = await callApi("/transactions");
  renderTransactionsPage();
  renderLatestTransactions();
  renderInsightsPage();
}

// What the filters currently ask for
function readFilters() {
  const minimumText = elementById("f-min").value, maximumText = elementById("f-max").value;
  return {
    searchText: elementById("f-search").value.trim().toLowerCase(),
    accountId: elementById("account-select").value,
    type: elementById("f-type").value,
    categoryId: elementById("f-category").value, // an id, or UNCATEGORIZED_FILTER_VALUE
    fromDate: elementById("f-from").value,
    toDate: elementById("f-to").value,
    minimumAmount: minimumText === "" ? null : Number(minimumText),
    maximumAmount: maximumText === "" ? null : Number(maximumText),
  };
}

function matchesFilters(transaction, filters) {
  const matchesAccount = !filters.accountId
    || transaction.from_account_id === Number(filters.accountId) || transaction.to_account_id === Number(filters.accountId);
  const matchesCategory = !filters.categoryId
    || (filters.categoryId === UNCATEGORIZED_FILTER_VALUE ? transaction.category_id == null : String(transaction.category_id) === filters.categoryId);
  const searchableText = `${transaction.description ?? ""} ${transaction.category ?? ""}`.toLowerCase();
  return matchesAccount
    && (!filters.type || transaction.type === filters.type)
    && matchesCategory
    && (!filters.fromDate || transaction.date >= filters.fromDate)
    && (!filters.toDate || transaction.date <= filters.toDate)
    && (filters.minimumAmount === null || transaction.amount >= filters.minimumAmount)
    && (filters.maximumAmount === null || transaction.amount <= filters.maximumAmount)
    && (!filters.searchText || searchableText.includes(filters.searchText));
}

export function renderTransactionsPage() {
  const filters = readFilters();
  const visibleTransactions = appState.transactions.filter((transaction) => matchesFilters(transaction, filters));
  fillTableBody("transactions-body", visibleTransactions, (transaction) => [
    transaction.date, createTypeBadge(transaction.type), transaction.from_account, transaction.to_account,
    createSignedAmountCell(transaction), transaction.category, createDescriptionCell(transaction),
  ]);
  makeRowsOpenTransactionEditor("transactions-body", visibleTransactions);

  const totalOfType = (type) => visibleTransactions.filter((transaction) => transaction.type === type).reduce((sum, transaction) => sum + transaction.amount, 0);
  elementById("tx-summary").textContent =
    `${visibleTransactions.length} of ${appState.transactions.length} transactions · income ${euroFormatter.format(totalOfType("income"))} · expenses ${euroFormatter.format(totalOfType("expense"))}`;
}

// Quick date ranges: [from, to]
function getQuickDateRange(rangeName) {
  const quickDateRanges = {
    today: [getLocalDateDaysFromToday(), getLocalDateDaysFromToday()],
    week: [getLocalDateDaysFromToday(-6), getLocalDateDaysFromToday()],
    month: [getTodayAsLocalDate().slice(0, 8) + "01", getLocalDateDaysFromToday()],
  };
  return quickDateRanges[rangeName];
}

export function initializeTransactionsPage() {
  const filterFields = document.querySelectorAll(".filters input, .filters select");
  filterFields.forEach((field) => field.addEventListener("input", renderTransactionsPage));

  document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => {
    [elementById("f-from").value, elementById("f-to").value] = getQuickDateRange(button.dataset.range);
    renderTransactionsPage();
  }));

  elementById("f-reset").addEventListener("click", () => {
    filterFields.forEach((field) => { field.value = ""; });
    renderTransactionsPage();
  });
}
