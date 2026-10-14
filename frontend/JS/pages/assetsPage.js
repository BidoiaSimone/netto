// ---- Assets page: the accounts list with its reconcile inputs (the pie is in assetsPieChart.js) ----

import { elementById, createElement, fillTableBody } from "../core/domHelpers.js";
import { euroFormatter, formatDifferenceWithPlusSign } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState, isAccountOpen } from "../core/appState.js";
import { refreshAccountPickers } from "../core/accountPickers.js";
import { renderAssetsPieChart } from "./assetsPieChart.js";
import { renderAccountsNeedingCheck } from "./homePage.js";
import { openAccountEditor } from "../dialogs/accountDialog.js";
import { getAccountKindLabel } from "../core/accountKinds.js";

const differenceCellByAccountId = new Map(); // the "Difference" cell of each row
let isShowingClosedAccounts = false;

export async function loadAccounts() {
  appState.accounts = await callApi("/accounts");
  renderAssetsPage();
  refreshAccountPickers();
  renderAccountsNeedingCheck();
}

export function renderAssetsPage() {
  differenceCellByAccountId.clear();
  const visibleAccounts = appState.accounts.filter((account) => isShowingClosedAccounts || isAccountOpen(account));
  fillTableBody("assets-body", visibleAccounts, createAccountRowCells);
  [...elementById("assets-body").rows].forEach((tableRow, index) => {
    tableRow.dataset.accountId = visibleAccounts[index].id; // lets the pie highlight the row
    tableRow.classList.toggle("closed", !isAccountOpen(visibleAccounts[index]));
  });
  updateShowClosedAccountsButton();
  updateReconcileDifferences();
  renderAssetsPieChart();
}

function createAccountRowCells(account) {
  const isOpen = isAccountOpen(account);
  const countedAmountInput = document.createElement("input");
  countedAmountInput.type = "number";
  countedAmountInput.step = "0.01";
  countedAmountInput.placeholder = isOpen ? "unchanged" : "closed";
  countedAmountInput.disabled = !isOpen;
  countedAmountInput.value = appState.countedAmountByAccountId[account.id] ?? "";
  countedAmountInput.oninput = () => {
    appState.countedAmountByAccountId[account.id] = countedAmountInput.value;
    updateReconcileDifferences();
  };

  const differenceCell = document.createElement("span");
  differenceCellByAccountId.set(account.id, differenceCell);

  // the name is the way in to edit / close the account (a separate column didn't fit)
  const nameButton = createElement("button", "name-link", account.name);
  nameButton.type = "button";
  nameButton.title = `Edit ${account.name}`;
  nameButton.onclick = () => openAccountEditor(account);

  const kindLabel = isOpen ? getAccountKindLabel(account.kind) : `${getAccountKindLabel(account.kind)} · closed`;
  return [nameButton, kindLabel, euroFormatter.format(account.balance), account.last_reconciled ?? "never", countedAmountInput, differenceCell];
}

function updateShowClosedAccountsButton() {
  const closedAccountCount = appState.accounts.filter((account) => !isAccountOpen(account)).length;
  const button = elementById("show-closed");
  button.hidden = !closedAccountCount;
  button.textContent = isShowingClosedAccounts ? "Hide closed accounts" : `Show closed accounts (${closedAccountCount})`;
}

// Live feedback while typing counted amounts: the difference per account,
// and the net worth you'd get after reconciling
export function updateReconcileDifferences() {
  let totalDifference = 0;
  for (const account of appState.accounts.filter(isAccountOpen)) {
    const countedAmount = appState.countedAmountByAccountId[account.id];
    const differenceCell = differenceCellByAccountId.get(account.id);
    // rounded to the cent: subtracting two euro floats can leave noise like 0.0000001
    const difference = countedAmount === undefined || countedAmount === "" ? null : Math.round((Number(countedAmount) - account.balance) * 100) / 100;
    if (difference !== null) totalDifference += difference;
    if (differenceCell) {
      differenceCell.textContent = difference === null ? "" : formatDifferenceWithPlusSign(difference);
      differenceCell.className = difference > 0 ? "pos" : difference < 0 ? "neg" : "";
    }
  }
  const netWorth = appState.netWorth;
  elementById("reconcile-summary").textContent = netWorth
    ? `Net worth now ${euroFormatter.format(netWorth.net_worth)} → after reconciling ${euroFormatter.format(netWorth.net_worth + totalDifference)} (${totalDifference >= 0 ? "+" : ""}${euroFormatter.format(totalDifference)})`
    : "";
}

export function initializeAssetsPage() {
  elementById("show-closed").addEventListener("click", () => {
    isShowingClosedAccounts = !isShowingClosedAccounts;
    renderAssetsPage();
  });
}
