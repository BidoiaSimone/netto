// ---- transaction dialog: adds a new transaction, or edits one ----
// The same <dialog id="tx-dialog"> does both: switchTransactionDialogMode() changes its title and buttons.
// "Paid in another currency" (yen on a trip) is its own file: foreignCurrencyFields.js.
// To make adding one quick (the phone, in a queue at the till):
//   - a new transaction starts on the account you used last for that type (remembered on this device)
//   - Today / Yesterday / 2 days ago set the date in one tap
//   - the description suggests the ones you've used; picking one fills in the type, category, account and amount
//     you used with it last time (only the fields still empty, and only for a new transaction)
//   - deleting asks nothing: a bar at the bottom offers Undo for a few seconds instead
//   - the amount takes "4,70" or "4.70" and sums: "42,80-21,40" (groceries minus your roommate's half), "4,70+1,20";
//     the − and + buttons type them where the phone's number pad has neither; the result shows under it, and
//     replaces the sum when you leave the field

import { elementById, makeTableRowsOpenItems, highlightSelectedChip } from "../core/domHelpers.js";
// single transactions stay readable with Hide amounts on (see core/formatting.js)
import { visibleEuroFormatter as euroFormatter, getTodayAsLocalDate, getLocalDateDaysFromToday } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { addTransactionNowOrLater } from "../core/offlineQueue.js";
import { loadAllData } from "../core/dataRefresh.js";
import { addClosedAccountOptionIfMissing } from "../core/accountPickers.js";
import { fillCategoryPicker } from "../core/categoryPickers.js";
import { openDialog } from "../app/dialogWindows.js";
import { appState } from "../core/appState.js";
import { showToast } from "../core/toast.js";
import { offerToLinkPurchase } from "../pages/goalsPage.js";
import { forgetPendingChange } from "../core/pendingChanges.js";
import { evaluateAmount, isSum } from "../core/amountExpression.js";
import { renderTransactionCategoryChips, showPickedCategoryChip, initializeTransactionCategoryChips } from "./transactionCategoryChips.js";
import { setPickedTags, setTagPickerDisabled, refreshTagSuggestions, readPickedTags, initializeTransactionTagPicker } from "./transactionTagPicker.js";
import {
  fillForeignCurrencyFields, hideForeignCurrencyFields, readForeignCurrencyFields, setForeignCurrencyFieldsDisabled,
  rememberLastCurrency, initializeForeignCurrencyFields,
} from "./foreignCurrencyFields.js";

let transactionBeingEdited = null; // null when adding a new one

export function switchTransactionDialogMode(transactionToEdit) {
  transactionBeingEdited = transactionToEdit;
  elementById("tx-title").textContent = transactionToEdit ? "Edit transaction" : "New transaction";
  elementById("tx-submit").textContent = transactionToEdit ? "Save changes" : "Add transaction";
  elementById("tx-dialog").classList.toggle("editing", Boolean(transactionToEdit)); // Pocket's sheet: Delete at the bottom
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
  form.amount.value = formatAmountForTyping(transaction.amount);
  updateAmountResult();
  elementById("tx-date").value = transaction.date;
  highlightDateChip();
  fillForeignCurrencyFields(transaction); // after the date: the market rate shown is that day's
  form.description.value = transaction.description ?? "";
  updateTransactionFieldsForType(); // fills the category list for this type: pick the category after it
  elementById("tx-category").value = transaction.category_id ?? "";
  showPickedCategoryChip();
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
  setForeignCurrencyFieldsDisabled(isReconciliation || isInvestmentCash); // their amount can't change, so neither can its currency
  refreshTagSuggestions();
  showTypeInSegments(type);
  renderTransactionCategoryChips(); // after the disabling above: an investment's category can't change
}

// ---------- Pocket's type switch: Expense | Income | Movement ----------
// Pocket draws the type as a segmented control (the select under it is hidden there, 37-ui-pocket.css); tapping a
// segment sets the select and fires its "change", so everything else still listens to the select only.
// The window also carries the type (data-type) so Pocket can leave out the account row the type doesn't use,
// and name the one it does "Account".
const SEGMENT_TYPES = ["expense", "income", "movement"];

function showTypeInSegments(type) {
  const dialog = elementById("tx-dialog"), typePicker = elementById("tx-type");
  dialog.dataset.type = type;
  const segments = elementById("tx-type-segments");
  segments.hidden = !SEGMENT_TYPES.includes(type); // a reconciliation or a trade: its note says what it is
  for (const segment of segments.children) {
    const isSelected = segment.dataset.type === type;
    segment.classList.toggle("active", isSelected);
    segment.setAttribute("aria-checked", String(isSelected));
    segment.tabIndex = isSelected ? 0 : -1;
    segment.disabled = typePicker.disabled;
  }
  const [fromLabel, toLabel] = elementById("tx-form").querySelectorAll(".tx-accounts .form-label");
  fromLabel.textContent = type === "movement" ? "From" : "Account";
  toLabel.textContent = type === "movement" ? "To" : "Account";
}

function createTypeSegments() {
  const typePicker = elementById("tx-type"), segments = elementById("tx-type-segments");
  segments.replaceChildren(...SEGMENT_TYPES.map((type) => {
    const segment = document.createElement("button");
    segment.type = "button";
    segment.dataset.type = type;
    segment.setAttribute("role", "radio");
    segment.textContent = typePicker.querySelector(`option[value="${type}"]`).textContent;
    return segment;
  }));
  const pick = (type) => {
    if (typePicker.disabled || typePicker.value === type) return;
    typePicker.value = type;
    typePicker.dispatchEvent(new Event("change", { bubbles: true }));
  };
  segments.addEventListener("click", (event) => {
    const segment = event.target.closest("button[data-type]");
    if (segment) pick(segment.dataset.type);
  });
  segments.addEventListener("keydown", (event) => { // arrows move along, like a radio group
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = SEGMENT_TYPES.indexOf(typePicker.value);
    const next = SEGMENT_TYPES[(index + step + SEGMENT_TYPES.length) % SEGMENT_TYPES.length];
    pick(next);
    segments.querySelector(`[data-type="${next}"]`).focus();
  });
}

// The form's values in the shape the API expects. Tags always go along (even none), so an edit that
// removes every tag really removes them.
function readTransactionForm(form) {
  const formValues = Object.fromEntries(new FormData(form));
  return {
    ...readPickedTags(),
    ...readForeignCurrencyFields(), // original_currency + original_amount, or both null (paid in euros)
    type: formValues.type,
    amount: evaluateAmount(formValues.amount) ?? NaN,
    from_account_id: formValues.from_account_id ? Number(formValues.from_account_id) : null,
    to_account_id: formValues.to_account_id ? Number(formValues.to_account_id) : null,
    date: formValues.date || null, // empty = the server uses today
    category_id: formValues.category_id ? Number(formValues.category_id) : null,
    description: formValues.description || null,
  };
}

// A new transaction with the server out of reach (the phone while the Mac sleeps) is kept on this device and sent
// later (core/offlineQueue.js). Changing or deleting one needs the server: those just say so.
async function saveTransaction(event) {
  event.preventDefault();
  const transaction = readTransactionForm(event.target);
  let added = null;
  try {
    if (transactionBeingEdited) await callApi(`/transactions/${transactionBeingEdited.id}`, { method: "PUT", body: transaction });
    else {
      added = await addTransactionNowOrLater(transaction, getTodayAsLocalDate());
      if (added.cancelled) return; // the same one again: you said no
    }
  } catch (error) {
    elementById("tx-error").textContent = error.isServerUnreachable
      ? "Your Mac can't be reached, and this device couldn't keep the change."
      : error.message; // shown inside the dialog, which stays open
    return;
  }
  if (transaction.original_currency) rememberLastCurrency(transaction.original_currency);
  if (!transactionBeingEdited) rememberAccounts(transaction);
  event.target.reset();
  setPickedTags([]);
  hideForeignCurrencyFields();
  elementById("tx-dialog").close();
  loadAllData();
  if (added?.added) offerToLinkPurchase(added.id, transaction); // a big expense: "Is this the MacBook?" (Goals)
}

// An expense, income or movement typed in by hand can be put back exactly as it was (POST again, tags included).
// A reconciliation or one added by a recurring transaction can't (the server makes those), so those still ask first.
const canBeUndone = (transaction) => ["expense", "income", "movement"].includes(transaction.type) && !transaction.recurring_transaction_id;

// The deleted transaction as POST /transactions takes it, to add it back
const toNewTransaction = (transaction) => ({
  type: transaction.type, amount: transaction.amount, date: transaction.date,
  from_account_id: transaction.from_account_id, to_account_id: transaction.to_account_id,
  category_id: transaction.category_id, description: transaction.description,
  tag_ids: (transaction.tags ?? []).map((tag) => tag.id),
  original_currency: transaction.original_currency ?? null,
  original_amount: transaction.original_currency ? transaction.original_amount : null,
});

async function deleteTransactionBeingEdited() {
  const transaction = transactionBeingEdited;
  if (!transaction) return;
  const typeName = transaction.type === "adjustment" ? "reconciliation" : transaction.type;
  const undoable = canBeUndone(transaction);
  if (!undoable && !confirm(`Delete this ${typeName} of ${euroFormatter.format(transaction.amount)} from ${transaction.date}?\n\nThe account balances are corrected automatically.`)) return;
  let result;
  try {
    result = await callApi(`/transactions/${transaction.id}`, { method: "DELETE" });
  } catch (error) {
    elementById("tx-error").textContent = error.message;
    return;
  }
  elementById("tx-dialog").close();
  if (result?.kept) {
    // the Mac can't be reached: deleted here now, on the Mac when it's back (core/pendingChanges.js); undo = don't send it
    const name = transaction.description || transaction.category || typeName;
    showToast(`${name} ${euroFormatter.format(transaction.amount)} deleted: sent when your Mac is back`, [{
      label: "Undo", onClick: () => { forgetPendingChange(result.change_id); loadAllData(); },
    }]);
  } else if (undoable) {
    const name = transaction.description || transaction.category || typeName;
    showToast(`${name} ${euroFormatter.format(transaction.amount)} deleted`, [{
      label: "Undo",
      onClick: () => callApi("/transactions", { method: "POST", body: toNewTransaction(transaction) })
        .then(() => loadAllData())
        .catch((error) => showToast(`Couldn't put it back: ${error.message}`)),
    }]);
  }
  loadAllData();
}

// ---------- the amount: "4,70", "4.70" or a sum ----------

// 4.7 -> "4,70": the way the phone's keypad types it, so editing it doesn't mix the two decimal marks
const formatAmountForTyping = (amount) => (amount == null ? "" : Number(amount).toFixed(2).replace(".", ","));

// "= 5,90 €" under a sum; the field refuses (with the reason) anything that isn't an amount above 0
function updateAmountResult() {
  const input = elementById("tx-form").amount;
  const value = evaluateAmount(input.value);
  const isValid = input.value.trim() === "" || (value !== null && value > 0);
  input.setCustomValidity(isValid ? "" : value !== null && value <= 0 ? "The amount must be above 0" : "Type an amount like 4,70 or a sum like 4,70+1,20");
  elementById("tx-amount-result").textContent = isValid && isSum(input.value) ? `= ${euroFormatter.format(value)}` : "";
}

// Leaving the field: a sum becomes its result
function replaceSumWithResult() {
  const input = elementById("tx-form").amount;
  const value = evaluateAmount(input.value);
  if (isSum(input.value) && value !== null && value > 0) {
    input.value = formatAmountForTyping(value);
    input.dispatchEvent(new Event("input", { bubbles: true })); // the foreign-currency rate follows the new amount
  }
}

// ---------- the account you used last, per type (this device) ----------

const LAST_ACCOUNTS_KEY = "netto.lastAccounts";
const readLastAccounts = () => { try { return JSON.parse(localStorage.getItem(LAST_ACCOUNTS_KEY)) ?? {}; } catch { return {}; } };

function rememberAccounts(transaction) {
  const lastAccounts = readLastAccounts();
  lastAccounts[transaction.type] = { from: transaction.from_account_id, to: transaction.to_account_id };
  try { localStorage.setItem(LAST_ACCOUNTS_KEY, JSON.stringify(lastAccounts)); } catch {}
}

// A new transaction's empty account fields get the ones used last for its type (if still open)
export function applyRememberedAccounts() {
  if (transactionBeingEdited) return;
  const remembered = readLastAccounts()[elementById("tx-type").value];
  if (!remembered) return;
  for (const [pickerId, accountId] of [["tx-from", remembered.from], ["tx-to", remembered.to]]) {
    const picker = elementById(pickerId);
    if (!picker.disabled && !picker.value && accountId != null && [...picker.options].some((option) => option.value === String(accountId))) picker.value = accountId;
  }
}

// ---------- Today / Yesterday / 2 days ago ----------

function highlightDateChip() {
  const date = elementById("tx-date").value || getTodayAsLocalDate();
  const chips = elementById("tx-date-chips");
  const daysBack = [0, -1, -2].find((offset) => getLocalDateDaysFromToday(offset) === date);
  highlightSelectedChip(chips, daysBack === undefined ? null : String(daysBack), "days");
}

// ---------- descriptions you've used, with what came with them ----------

let knownDescriptions = new Map(); // lower-case description -> the newest transaction with it

// The suggestions under the description field: newest first, each with its category and account as a hint
export function refreshDescriptionSuggestions() {
  knownDescriptions = new Map();
  for (const transaction of appState.transactions) { // newest first
    if (!["expense", "income", "movement"].includes(transaction.type) || !transaction.description) continue;
    const key = transaction.description.trim().toLowerCase();
    if (!knownDescriptions.has(key)) knownDescriptions.set(key, transaction);
  }
  elementById("description-suggestions").replaceChildren(...[...knownDescriptions.values()].slice(0, 200).map((transaction) => {
    const account = transaction.type === "income" ? transaction.to_account : transaction.from_account;
    return new Option([transaction.category, account].filter(Boolean).join(" · "), transaction.description.trim());
  }));
}

// A description picked from the suggestions (or typed exactly): fill what came with it, where still empty
function fillFromKnownDescription() {
  if (transactionBeingEdited) return;
  const form = elementById("tx-form");
  const known = knownDescriptions.get(form.description.value.trim().toLowerCase());
  if (!known) return;
  if (elementById("tx-type").value !== known.type) {
    elementById("tx-type").value = known.type;
    updateTransactionFieldsForType(); // the category list depends on the type
  }
  const fillIfEmpty = (field, value) => { if (!field.value && value != null) field.value = value; };
  fillIfEmpty(elementById("tx-category"), known.category_id);
  showPickedCategoryChip();
  fillIfEmpty(elementById("tx-from"), known.type !== "income" ? known.from_account_id : null);
  fillIfEmpty(elementById("tx-to"), known.type !== "expense" ? known.to_account_id : null);
  fillIfEmpty(form.amount, formatAmountForTyping(known.amount));
  updateAmountResult();
  if (!form.amount.value || form.amount === document.activeElement) return;
  form.amount.focus(); // the amount is what usually changes: ready to type over
  form.amount.select();
}

// A new transaction: today's date chip lit, the accounts used last
export function prepareNewTransaction() {
  highlightDateChip();
  applyRememberedAccounts();
}

export function initializeTransactionDialog() {
  createTypeSegments();
  elementById("tx-form").addEventListener("submit", saveTransaction);
  elementById("tx-delete").addEventListener("click", deleteTransactionBeingEdited);
  // Leaving the edit dialog clears it, so "+ Add transaction" never starts from an old transaction.
  // (A half-typed NEW transaction is kept.)
  elementById("tx-dialog").addEventListener("close", () => {
    if (transactionBeingEdited) {
      elementById("tx-form").reset();
      setPickedTags([]);
      hideForeignCurrencyFields();
      switchTransactionDialogMode(null);
    }
  });
  elementById("tx-type").addEventListener("change", () => { updateTransactionFieldsForType(); applyRememberedAccounts(); });
  const amountInput = elementById("tx-form").amount;
  amountInput.addEventListener("input", updateAmountResult);
  amountInput.addEventListener("blur", replaceSumWithResult);
  for (const operatorButton of document.querySelectorAll("#tx-form .amount-operator")) {
    operatorButton.addEventListener("pointerdown", (event) => event.preventDefault()); // keeps the keyboard up
    operatorButton.addEventListener("click", () => {
      if (amountInput.disabled) return;
      // a second tap swaps the sign instead of adding another one: "42,80-" + tap "+" = "42,80+"
      amountInput.value = amountInput.value.replace(/[-+\s]+$/, "") + operatorButton.dataset.operator;
      amountInput.focus();
      amountInput.setSelectionRange(amountInput.value.length, amountInput.value.length);
      updateAmountResult();
    });
  }
  elementById("tx-form").addEventListener("reset", () => setTimeout(updateAmountResult));
  elementById("tx-date-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-days]");
    if (!chip) return;
    elementById("tx-date").value = getLocalDateDaysFromToday(Number(chip.dataset.days));
    highlightDateChip();
  });
  elementById("tx-date").addEventListener("input", highlightDateChip);
  elementById("tx-form").description.addEventListener("change", fillFromKnownDescription);
  elementById("tx-form").description.addEventListener("input", (event) => {
    // picked from the suggestions: Safari fires "input" with no inputType, typing has one
    if (!event.inputType || event.inputType === "insertReplacementText") fillFromKnownDescription();
  });
  elementById("tx-form").addEventListener("reset", () => setTimeout(() => {
    hideForeignCurrencyFields();
    updateTransactionFieldsForType();
  }));
  initializeTransactionTagPicker();
  initializeForeignCurrencyFields();
  initializeTransactionCategoryChips();
}
