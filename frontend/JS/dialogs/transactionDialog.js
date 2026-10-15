// ---- transaction dialog: adds a new transaction, or edits one ----
// The same <dialog id="tx-dialog"> does both: switchTransactionDialogMode() changes its title and buttons.

import { elementById, makeTableRowsOpenItems } from "../core/domHelpers.js";
import { euroFormatter } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { loadAllData } from "../core/dataRefresh.js";
import { addClosedAccountOptionIfMissing } from "../core/accountPickers.js";
import { fillCategoryPicker } from "../core/categoryPickers.js";
import { openDialog } from "../app/dialogWindows.js";
import { setPickedTags, setTagPickerDisabled, refreshTagSuggestions, readPickedTags, initializeTransactionTagPicker } from "./transactionTagPicker.js";

let transactionBeingEdited = null; // null when adding a new one

export function switchTransactionDialogMode(transactionToEdit) {
  transactionBeingEdited = transactionToEdit;
  elementById("tx-title").textContent = transactionToEdit ? "Edit transaction" : "New transaction";
  elementById("tx-submit").textContent = transactionToEdit ? "Save changes" : "Add transaction";
  elementById("tx-delete").hidden = !transactionToEdit;
  elementById("tx-error").textContent = "";
  elementById("tx-recurring-note").hidden = !transactionToEdit?.recurring_transaction_id;
}

export function openTransactionEditor(transaction) {
  openDialog("tx-dialog"); // also switches back to "new" mode; edit mode is set right after
  switchTransactionDialogMode(transaction);
  const form = elementById("tx-form");
  addClosedAccountOptionIfMissing(elementById("tx-from"), transaction.from_account_id);
  addClosedAccountOptionIfMissing(elementById("tx-to"), transaction.to_account_id);
  elementById("tx-type").value = transaction.type;
  elementById("tx-from").value = transaction.from_account_id ?? "";
  elementById("tx-to").value = transaction.to_account_id ?? "";
  form.amount.value = transaction.amount;
  elementById("tx-date").value = transaction.date;
  form.description.value = transaction.description ?? "";
  updateTransactionFieldsForType(); // fills the category list for this type: pick the category after it
  elementById("tx-category").value = transaction.category_id ?? "";
  setPickedTags(transaction.tags);
  form.amount.focus();
}

// Clicking a row of a transactions table (or Enter on it) opens that transaction here
export function makeRowsOpenTransactionEditor(tableBodyId, transactions) {
  makeTableRowsOpenItems(tableBodyId, transactions, openTransactionEditor);
}

// Income only has a destination, expense only a source, movement has both.
// Reconciliations and the cash side of investment trades can only be partly changed (or not at all) here.
export function updateTransactionFieldsForType() {
  const form = elementById("tx-form");
  const fromAccountPicker = elementById("tx-from"), toAccountPicker = elementById("tx-to");
  const type = elementById("tx-type").value;
  fillCategoryPicker(elementById("tx-category"), type); // income and expense each have their own categories
  const isReconciliation = type === "adjustment"; // only when editing one: see PUT /transactions/:id
  const isInvestmentCash = type === "investment"; // the money side of a trade: read-only here, see the Investments page

  fromAccountPicker.disabled = type === "income" || isReconciliation;
  toAccountPicker.disabled = type === "expense" || isReconciliation;
  fromAccountPicker.required = type !== "income" && !isReconciliation;
  toAccountPicker.required = type !== "expense" && !isReconciliation;
  elementById("tx-type").disabled = isReconciliation || isInvestmentCash;
  form.amount.disabled = isReconciliation || isInvestmentCash;
  elementById("tx-adjust-note").hidden = !isReconciliation;
  elementById("tx-invest-note").hidden = !isInvestmentCash;
  for (const fieldName of ["date", "category_id", "description"]) form[fieldName].disabled = isInvestmentCash;
  if (isInvestmentCash) {
    fromAccountPicker.disabled = toAccountPicker.disabled = true;
    fromAccountPicker.required = toAccountPicker.required = false;
  }
  elementById("tx-submit").hidden = isInvestmentCash;
  if (isInvestmentCash) elementById("tx-delete").hidden = true;
  setTagPickerDisabled(isInvestmentCash); // reconciliations can still be tagged (their details are editable)
  refreshTagSuggestions();
}

// The form's values in the shape the API expects. Tags always go along (even none), so an edit that
// removes every tag really removes them.
function readTransactionForm(form) {
  const formValues = Object.fromEntries(new FormData(form));
  return {
    ...readPickedTags(),
    type: formValues.type,
    amount: Number(formValues.amount),
    from_account_id: formValues.from_account_id ? Number(formValues.from_account_id) : null,
    to_account_id: formValues.to_account_id ? Number(formValues.to_account_id) : null,
    date: formValues.date || null, // empty = the server uses today
    category_id: formValues.category_id ? Number(formValues.category_id) : null,
    description: formValues.description || null,
  };
}

async function saveTransaction(event) {
  event.preventDefault();
  const transaction = readTransactionForm(event.target);
  try {
    if (transactionBeingEdited) await callApi(`/transactions/${transactionBeingEdited.id}`, { method: "PUT", body: transaction });
    else await callApi("/transactions", { method: "POST", body: transaction });
  } catch (error) {
    elementById("tx-error").textContent = error.message; // shown inside the dialog, which stays open
    return;
  }
  event.target.reset();
  setPickedTags([]);
  elementById("tx-dialog").close();
  loadAllData();
}

async function deleteTransactionBeingEdited() {
  const transaction = transactionBeingEdited;
  const typeName = transaction?.type === "adjustment" ? "reconciliation" : transaction?.type;
  if (!transaction || !confirm(`Delete this ${typeName} of ${euroFormatter.format(transaction.amount)} from ${transaction.date}?\n\nThe account balances are corrected automatically.`)) return;
  try {
    await callApi(`/transactions/${transaction.id}`, { method: "DELETE" });
  } catch (error) {
    elementById("tx-error").textContent = error.message;
    return;
  }
  elementById("tx-dialog").close();
  loadAllData();
}

export function initializeTransactionDialog() {
  elementById("tx-form").addEventListener("submit", saveTransaction);
  elementById("tx-delete").addEventListener("click", deleteTransactionBeingEdited);
  // Leaving the edit dialog clears it, so "+ Add transaction" never starts from an old transaction.
  // (A half-typed NEW transaction is kept.)
  elementById("tx-dialog").addEventListener("close", () => {
    if (transactionBeingEdited) {
      elementById("tx-form").reset();
      setPickedTags([]);
      switchTransactionDialogMode(null);
    }
  });
  elementById("tx-type").addEventListener("change", updateTransactionFieldsForType);
  elementById("tx-form").addEventListener("reset", () => setTimeout(updateTransactionFieldsForType));
  initializeTransactionTagPicker();
}
