// ---- Transactions page: the full list with its filters (all client-side, so they apply instantly) ----

import { elementById, createElement, fillTableBody, createTypeBadge } from "../core/domHelpers.js";
// single transactions stay readable with Hide amounts on (see core/formatting.js)
import { visibleEuroFormatter as euroFormatter, getTodayAsLocalDate, getLocalDateDaysFromToday } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { applyPendingTransactionChanges } from "../core/pendingChanges.js";
import { createSignedAmountCell, createDescriptionCell, createTransactionIcon, describeDay, describeMovementRoute } from "../core/transactionDisplay.js";
import { renderLatestTransactions } from "./homePage.js";
import { renderQuickAdd } from "./quickAdd.js";
import { refreshDescriptionSuggestions } from "../dialogs/transactionDialog.js";
import { renderInsightsPage } from "./insightsPage.js";
import { makeRowsOpenTransactionEditor } from "../dialogs/transactionDialog.js";
import { UNCATEGORIZED_FILTER_VALUE } from "../core/categoryPickers.js";

const UNTAGGED_FILTER_VALUE = "__none"; // the "No tags" choice of the tag filter

export async function loadTransactions() {
  appState.transactions = applyPendingTransactionChanges(await callApi("/transactions")); // edits / deletions not sent yet included
  renderTransactionsPage();
  renderLatestTransactions();
  renderQuickAdd(); // Home's one-tap buttons come from the transactions
  refreshDescriptionSuggestions(); // and so do the description suggestions of the transaction dialog
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
    tagId: elementById("f-tag").value,           // an id, or UNTAGGED_FILTER_VALUE
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
  const matchesTag = !filters.tagId
    || (filters.tagId === UNTAGGED_FILTER_VALUE ? transaction.tags.length === 0 : transaction.tags.some((tag) => String(tag.id) === filters.tagId));
  const tagNames = transaction.tags.map((tag) => tag.name).join(" ");
  const searchableText = `${transaction.description ?? ""} ${transaction.category ?? ""} ${tagNames}`.toLowerCase();
  return matchesAccount
    && (!filters.type || transaction.type === filters.type)
    && matchesCategory
    && matchesTag
    && (!filters.fromDate || transaction.date >= filters.fromDate)
    && (!filters.toDate || transaction.date <= filters.toDate)
    && (filters.minimumAmount === null || transaction.amount >= filters.minimumAmount)
    && (filters.maximumAmount === null || transaction.amount <= filters.maximumAmount)
    && (!filters.searchText || searchableText.includes(filters.searchText));
}

// With no filter at all only the latest ones are drawn: a long list makes the page slow to draw and scroll, mostly
// on the phone. Any filter (a search, a date, an account…) shows every transaction that matches.
const UNFILTERED_LIMIT = 50;

const isAnyFilterSet = (filters) => Object.values(filters).some((value) => value !== "" && value !== null);

export function renderTransactionsPage() {
  const filters = readFilters();
  const matchingTransactions = appState.transactions.filter((transaction) => matchesFilters(transaction, filters));
  const visibleTransactions = isAnyFilterSet(filters) ? matchingTransactions : matchingTransactions.slice(0, UNFILTERED_LIMIT);
  fillTableBody("transactions-body", visibleTransactions, (transaction) => [
    transaction.date, createTypeBadge(transaction.type), transaction.from_account, transaction.to_account,
    createSignedAmountCell(transaction), transaction.category, createDescriptionCell(transaction), createTagsCell(transaction),
    createTransactionIcon(transaction), // last, so the phone's card layout (31-phone.css) keeps its cell numbers
  ]);
  makeRowsOpenTransactionEditor("transactions-body", visibleTransactions); // before the day rows go in: it pairs rows and transactions by position
  markRowsForPocket(visibleTransactions);
  addDayRows(visibleTransactions);

  // the totals are of every matching transaction, also the ones beyond the first 50
  const totalOfType = (type) => matchingTransactions.filter((transaction) => transaction.type === type).reduce((sum, transaction) => sum + transaction.amount, 0);
  const countText = visibleTransactions.length < matchingTransactions.length
    ? `Latest ${visibleTransactions.length} of ${appState.transactions.length} transactions (filter to see older ones)`
    : `${matchingTransactions.length} of ${appState.transactions.length} transactions`;
  elementById("tx-summary").textContent =
    `${countText} · income ${euroFormatter.format(totalOfType("income"))} · expenses ${euroFormatter.format(totalOfType("expense"))}`;
}

// ---------- Pocket's list: grouped by day, each row led by a round icon ----------
// Classic doesn't show any of this (10-editable-rows-and-accounts.css hides the day rows and the icons).

// What the row's two lines show in Pocket: the description on top (or the category, when there's none) and the
// category · account under it. The account is where the money went for income, where it came from otherwise.
function markRowsForPocket(transactions) {
  [...elementById("transactions-body").rows].forEach((row, index) => {
    const transaction = transactions[index];
    row.classList.add(`tx-${transaction.type}`);
    row.classList.toggle("no-description", !transaction.description);
    row.classList.toggle("no-category", !transaction.category);
    // a movement's title is its route, "Edenred → BBVA"; a description, if any, goes under it (Pocket only:
    // Classic has its own From and To columns, so 37-ui-pocket.css hides the route there)
    if (transaction.type === "movement") {
      row.cells[6].prepend(createElement("span", "movement-route", describeMovementRoute(transaction)));
      row.classList.remove("no-description");
    }
  });
}

// A header row before each day's transactions: "Yesterday   −23,40 €" (what the day's income and expenses add up to,
// when there's more than one)
function addDayRows(transactions) {
  const rows = [...elementById("transactions-body").rows];
  let currentDate = null;
  rows.forEach((row, index) => {
    const date = transactions[index].date;
    if (date === currentDate) return;
    currentDate = date;
    const ofTheDay = transactions.filter((transaction) => transaction.date === date);
    const dayTotal = ofTheDay.reduce((sum, transaction) =>
      sum + (transaction.type === "income" ? transaction.amount : transaction.type === "expense" ? -transaction.amount : 0), 0);
    const dayRow = createElement("tr", "day-row");
    const cell = createElement("td");
    cell.colSpan = 9;
    cell.append(createElement("span", "day-name", describeDay(date)));
    if (dayTotal !== 0 && ofTheDay.length > 1) cell.append(createElement("span", "day-total", (dayTotal > 0 ? "+" : "−") + euroFormatter.format(Math.abs(dayTotal))));
    dayRow.append(cell);
    row.before(dayRow);
  });
}

// The transaction's tags as small chips. Clicking one shows only that tag's transactions
// (instead of opening the transaction, which a click anywhere else on the row does).
function createTagsCell(transaction) {
  const cell = createElement("span", "tag-chips");
  for (const tag of transaction.tags) {
    const chip = createElement("button", "tag-chip", tag.name);
    chip.type = "button";
    chip.title = `Show only "${tag.name}"`;
    chip.onclick = (event) => {
      event.stopPropagation();
      elementById("f-tag").value = String(tag.id);
      renderTransactionsPage();
    };
    chip.onkeydown = (event) => event.stopPropagation(); // Enter on the chip mustn't also open the row
    cell.append(chip);
  }
  return cell;
}

// The tag filter: every tag by name, plus "No tags". Called whenever the tags reload.
export function fillTagFilter() {
  const tagFilter = elementById("f-tag"), filteredTagId = tagFilter.value;
  tagFilter.replaceChildren(new Option("All tags", ""), ...appState.tags.map((tag) => new Option(tag.name, tag.id)),
    new Option("No tags", UNTAGGED_FILTER_VALUE));
  tagFilter.value = filteredTagId;
  if (tagFilter.value !== filteredTagId) tagFilter.value = ""; // the tag was deleted
  renderTransactionsPage();
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
  // phones: the filters other than the search and the date chips fold away behind a "Filters" button (31-phone.css)
  elementById("f-more").addEventListener("click", () => {
    const isOpen = document.querySelector(".filters").classList.toggle("open");
    elementById("f-more").setAttribute("aria-expanded", String(isOpen));
  });
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
