// ---- dialogs: each "add" form opens from a button at the top right of its page ----

import { elementById } from "../core/domHelpers.js";
import { getTodayAsLocalDate } from "../core/formatting.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { switchAccountDialogMode } from "../dialogs/accountDialog.js";
import { switchTransactionDialogMode, updateTransactionFieldsForType, prepareNewTransaction } from "../dialogs/transactionDialog.js";
import { prepareNewRecurringTransaction } from "../dialogs/recurringTransactionDialog.js";
import { measureVisibleAreaNow } from "./sheetPosition.js";

// Opens a dialog in "add" mode (the edit functions switch it to edit mode right after)
export function openDialog(dialogId) {
  showErrorMessage("");
  if (dialogId === "account-dialog") switchAccountDialogMode(null);
  if (dialogId === "tx-dialog") {
    switchTransactionDialogMode(null);
    elementById("tx-date").value = elementById("tx-date").max = getTodayAsLocalDate();
    updateTransactionFieldsForType();
    prepareNewTransaction();
  }
  if (dialogId === "recurring-dialog") prepareNewRecurringTransaction();
  const dialog = elementById(dialogId);
  measureVisibleAreaNow();
  dialog.showModal();
  // preventScroll: the browser mustn't scroll the page to the field itself. On the iPhone that scroll is taken while
  // the sheet is still rising from lower down, and left it above the screen (app/sheetPosition.js keeps it in view
  // when the keyboard comes up). Focusing right away, inside the tap, is what lets iOS open the keyboard at all.
  dialog.querySelector("[name=amount], [name=name], [name=ticker]")?.focus({ preventScroll: true });
}

// data-open="<dialog id>" buttons open it, data-close buttons and a click outside close it
export function initializeDialogWindows() {
  document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => openDialog(button.dataset.open)));
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }); // click outside
  });
}
