// ---- account dialog: adds an account, or edits one (rename, kind, opening balance, delete / close / reopen) ----
// The same <dialog id="account-dialog"> does both: switchAccountDialogMode() changes its title and buttons.

import { elementById } from "../core/domHelpers.js";
import { euroFormatter, formatCount } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { isAccountOpen } from "../core/appState.js";
import { loadAllData } from "../core/dataRefresh.js";
import { openDialog } from "../app/dialogWindows.js";
import { t } from "../core/i18n.js";

let accountBeingEdited = null; // null when adding a new one

// What the red button does depends on the account: unused -> delete, used -> close, closed -> reopen
const getRemoveButtonLabel = (account) => (!isAccountOpen(account) ? t("Reopen") : account.uses ? t("Close account") : t("Delete"));

export function switchAccountDialogMode(accountToEdit) {
  accountBeingEdited = accountToEdit;
  elementById("account-title").textContent = accountToEdit ? t("Edit {name}", { name: accountToEdit.name }) : t("New account or asset");
  elementById("account-submit").textContent = accountToEdit ? t("Save changes") : t("Add");
  elementById("account-opening-label").textContent = accountToEdit ? t("Opening balance (€, before any transaction)") : t("What it holds today (€)");
  elementById("account-error").textContent = "";
  const infoLine = elementById("account-info"), removeButton = elementById("account-remove");
  infoLine.hidden = removeButton.hidden = !accountToEdit;
  if (!accountToEdit) return;

  removeButton.textContent = getRemoveButtonLabel(accountToEdit);
  removeButton.className = isAccountOpen(accountToEdit) ? "danger" : "ghost reopen";
  const usesDescription = accountToEdit.uses ? formatCount(accountToEdit.uses, "transaction") : t("no transactions yet");
  infoLine.textContent = !isAccountOpen(accountToEdit)
    ? t("Closed on {date}. Its history stays on the Transactions page; reopen it to use it again.", { date: accountToEdit.closed_at })
    : t("Holds {amount} now · {uses}. Changing the opening balance moves the current balance by the same amount.", { amount: euroFormatter.format(accountToEdit.balance), uses: usesDescription });
}

export function openAccountEditor(account) {
  openDialog("account-dialog");
  switchAccountDialogMode(account);
  const form = elementById("account-form");
  form.name.value = account.name;
  form.kind.value = account.kind;
  form.opening_balance.value = account.opening_balance;
  form.name.focus();
}

async function saveAccount(event) {
  event.preventDefault();
  const formValues = Object.fromEntries(new FormData(event.target));
  const account = { name: formValues.name, kind: formValues.kind, opening_balance: Number(formValues.opening_balance) };
  try {
    if (accountBeingEdited) await callApi(`/accounts/${accountBeingEdited.id}`, { method: "PUT", body: account });
    else await callApi("/accounts", { method: "POST", body: account });
  } catch (error) {
    elementById("account-error").textContent = error.message; // the dialog stays open to fix it
    return;
  }
  event.target.reset();
  elementById("account-dialog").close();
  loadAllData();
}

// The request the red button sends, after asking for confirmation. null = cancelled or not allowed.
function chooseRemoveRequest(account) {
  if (!isAccountOpen(account)) return { path: `/accounts/${account.id}/reopen`, method: "POST" };
  if (!account.uses) {
    if (!confirm(t("Delete {name}? It has no transactions, so nothing else changes.", { name: account.name }))) return null;
    return { path: `/accounts/${account.id}`, method: "DELETE" };
  }
  if (account.balance !== 0) { // the server would refuse it anyway: say why before asking anything
    elementById("account-error").textContent = t("{name} still holds {amount}: move that money out, or reconcile it to 0, before closing it.", { name: account.name, amount: euroFormatter.format(account.balance) });
    return null;
  }
  const historyNote = account.uses === 1 ? t("its transaction stays") : t("its {count} transactions stay", { count: account.uses });
  if (!confirm(t("Close {name}?", { name: account.name }) + "\n\n" + t("It disappears from the Assets list and the pickers; {history}. You can reopen it any time from Show closed accounts.", { history: historyNote }))) return null;
  return { path: `/accounts/${account.id}/close`, method: "POST" };
}

async function deleteCloseOrReopenAccountBeingEdited() {
  if (!accountBeingEdited) return;
  const request = chooseRemoveRequest(accountBeingEdited);
  if (!request) return;
  try {
    await callApi(request.path, { method: request.method });
  } catch (error) {
    elementById("account-error").textContent = error.message; // e.g. closing an account that still holds money
    return;
  }
  elementById("account-dialog").close();
  loadAllData();
}

export function initializeAccountDialog() {
  elementById("account-form").addEventListener("submit", saveAccount);
  elementById("account-remove").addEventListener("click", deleteCloseOrReopenAccountBeingEdited);
  elementById("account-dialog").addEventListener("close", () => {
    if (accountBeingEdited) {
      elementById("account-form").reset();
      switchAccountDialogMode(null);
    }
  });
}
