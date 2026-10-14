// ---- Assets > Reconcile: confirm the counted amounts, then save them ----
// The Reconcile button only opens a summary; nothing is saved until "Confirm" is pressed.

import { elementById, createElement, fillTableBody } from "../core/domHelpers.js";
import { euroFormatter, formatDifferenceWithPlusSign } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState, isAccountOpen } from "../core/appState.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { runThenReloadAllData } from "../core/dataRefresh.js";

// Open accounts with a counted amount typed in, ready to be reconciled
function getAccountsToReconcile() {
  return appState.accounts
    .filter((account) => isAccountOpen(account) && appState.countedAmountByAccountId[account.id] !== undefined && appState.countedAmountByAccountId[account.id] !== "")
    .map((account) => {
      const countedAmount = Number(appState.countedAmountByAccountId[account.id]);
      return { account, countedAmount, difference: Math.round((countedAmount - account.balance) * 100) / 100 };
    });
}

function openReconcileConfirmation() {
  const accountsToReconcile = getAccountsToReconcile();
  if (!accountsToReconcile.length) {
    showErrorMessage("Type a counted amount for at least one account first.");
    return;
  }
  showErrorMessage("");
  fillTableBody("reconcile-confirm-body", accountsToReconcile, ({ account, countedAmount, difference }) => {
    const differenceColorClass = difference > 0 ? "pos" : difference < 0 ? "neg" : "";
    const differenceText = difference === 0 ? "no change" : formatDifferenceWithPlusSign(difference);
    return [account.name, euroFormatter.format(account.balance), euroFormatter.format(countedAmount), createElement("span", differenceColorClass, differenceText)];
  });
  const totalDifference = accountsToReconcile.reduce((sum, item) => sum + item.difference, 0);
  const netWorth = appState.netWorth;
  elementById("reconcile-confirm-total").textContent = netWorth
    ? `Net worth ${euroFormatter.format(netWorth.net_worth)} → ${euroFormatter.format(netWorth.net_worth + totalDifference)} (${formatDifferenceWithPlusSign(totalDifference)})`
    : `Total difference ${formatDifferenceWithPlusSign(totalDifference)}`;
  elementById("reconcile-dialog").showModal();
  elementById("reconcile-confirm").focus();
}

function saveReconciliations() {
  runThenReloadAllData(async () => {
    for (const { account, countedAmount } of getAccountsToReconcile()) {
      await callApi(`/accounts/${account.id}/reconcile`, { method: "POST", body: { counted: countedAmount } });
    }
    appState.countedAmountByAccountId = {};
  });
}

export function initializeReconcileDialog() {
  elementById("reconcile-apply").onclick = openReconcileConfirmation;
  elementById("reconcile-form").addEventListener("submit", saveReconciliations); // method="dialog": the dialog closes itself
}
