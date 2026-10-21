// ---- quick reconcile: count ONE account, from a reminder (Home, Next up) ----
// The Assets page reconciles several accounts at once; this dialog does the same for a single one, which is what a
// reminder needs (and what's handy on a phone). Same request as Assets > Reconcile: POST /accounts/:id/reconcile.
// "It's right" saves the recorded amount as counted: nothing changes but the date it was last checked.

import { elementById } from "../core/domHelpers.js";
import { euroFormatter, formatDifferenceWithPlusSign } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { loadAllData } from "../core/dataRefresh.js";

let accountBeingCounted = null; // { account_id, name, balance } from the reminders

export function openQuickReconcileDialog(reminder) {
  accountBeingCounted = reminder;
  const form = elementById("quick-reconcile-form");
  form.reset();
  elementById("quick-reconcile-title").textContent = `Reconcile ${reminder.name}`;
  elementById("quick-reconcile-recorded").textContent = euroFormatter.format(reminder.balance);
  elementById("quick-reconcile-error").textContent = "";
  updateDifference();
  elementById("quick-reconcile-dialog").showModal();
  form.counted.focus();
}

function updateDifference() {
  const countedText = elementById("quick-reconcile-form").counted.value;
  const line = elementById("quick-reconcile-difference");
  if (countedText === "" || !accountBeingCounted) return (line.textContent = "");
  const difference = Math.round((Number(countedText) - accountBeingCounted.balance) * 100) / 100;
  line.textContent = difference === 0 ? "Matches what netto has." : `Difference ${formatDifferenceWithPlusSign(difference)}: saved as a reconciliation.`;
  line.className = `trade-total ${difference > 0 ? "pos" : difference < 0 ? "neg" : ""}`;
}

async function saveCount(countedAmount) {
  try {
    await callApi(`/accounts/${accountBeingCounted.account_id}/reconcile`, { method: "POST", body: { counted: countedAmount } });
  } catch (error) {
    elementById("quick-reconcile-error").textContent = error.message;
    return;
  }
  elementById("quick-reconcile-dialog").close();
  loadAllData();
}

export function initializeQuickReconcileDialog() {
  const form = elementById("quick-reconcile-form");
  form.counted.addEventListener("input", updateDifference);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCount(Number(form.counted.value));
  });
  elementById("quick-reconcile-same").addEventListener("click", () => saveCount(accountBeingCounted.balance));
}
