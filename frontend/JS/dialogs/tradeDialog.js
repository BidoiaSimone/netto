// ---- trade dialog: buy or sell shares, or edit / delete a trade ----

import { elementById, createElement } from "../core/domHelpers.js";
// single transactions stay readable with Hide amounts on (see core/formatting.js)
import { visibleEuroFormatter as euroFormatter, shareCountFormatter, getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { loadAllData } from "../core/dataRefresh.js";
import { addClosedAccountOptionIfMissing } from "../core/accountPickers.js";
import { openDialog } from "../app/dialogWindows.js";

let tradeBeingEdited = null; // null for a new trade
let tradesWaitingToBeRecorded = []; // Investments > Target allocation > "Record these trades": the ones after this one

const getSharesHeld = (ticker) => appState.holdings.find((holding) => holding.ticker === ticker)?.shares ?? 0;

// trade: a trade to edit (isEditing = true), or a few fields to start a new one with ({ side, ticker })
export function openTradeDialog(trade = {}, { isEditing = false } = {}) {
  openDialog("trade-dialog");
  const form = elementById("trade-form");
  form.reset();
  tradeBeingEdited = isEditing ? trade : null;
  elementById("trade-error").textContent = "";
  elementById("trade-delete").hidden = !isEditing;
  elementById("trade-side").value = trade.side ?? "buy";
  form.ticker.value = trade.ticker ?? "";
  form.shares.value = trade.shares ?? "";   // a new trade can come prefilled (target allocation)
  form.price.value = trade.price ? Math.round(trade.price * 10000) / 10000 : "";
  form.fees.value = isEditing && trade.fees ? trade.fees : "";
  elementById("trade-date").max = getTodayAsLocalDate();
  elementById("trade-date").value = isEditing ? trade.date : getTodayAsLocalDate();
  selectTradeAccount(trade, isEditing);
  form.note.value = isEditing ? (trade.note ?? "") : "";
  updateTradeDialogTexts();
  (form.ticker.value ? form.shares : form.ticker).focus();
}

// An edited trade shows its own account; a new trade starts from the account used last time (if it still exists)
function selectTradeAccount(trade, isEditing) {
  const accountPicker = elementById("trade-account");
  if (isEditing) addClosedAccountOptionIfMissing(accountPicker, trade.account_id);
  const wantedAccountId = isEditing ? String(trade.account_id ?? "") : (localStorage.getItem("tradeAccount") ?? "");
  accountPicker.value = wantedAccountId;
  if (accountPicker.value !== wantedAccountId) accountPicker.value = "";
}

// Title, button and the line with the total, kept in step with what is typed
function updateTradeDialogTexts() {
  const form = elementById("trade-form");
  const isBuy = elementById("trade-side").value === "buy";
  const ticker = form.ticker.value.trim().toUpperCase();
  const waitingCount = tradeBeingEdited ? 0 : tradesWaitingToBeRecorded.length;
  elementById("trade-title").textContent = (tradeBeingEdited ? `Edit ${isBuy ? "buy" : "sale"}` : isBuy ? "Buy shares" : "Sell shares")
    + (waitingCount ? ` (${waitingCount} more after this)` : "");
  elementById("trade-submit").textContent = tradeBeingEdited ? "Save changes" : isBuy ? "Buy" : "Sell";
  elementById("trade-account-label").textContent = isBuy ? "Paid from" : "Paid into";

  const shares = Number(form.shares.value), pricePerShare = Number(form.price.value), fees = Number(form.fees.value) || 0;
  const total = shares > 0 && pricePerShare > 0 ? Math.round((shares * pricePerShare + (isBuy ? fees : -fees)) * 100) / 100 : null;
  const accountPicker = elementById("trade-account");
  const accountName = accountPicker.value ? accountPicker.selectedOptions[0].textContent : null;
  const totalLine = elementById("trade-total");
  totalLine.replaceChildren();
  if (total !== null) {
    totalLine.append(`${isBuy ? "Total cost" : "You receive"} `, createElement("strong", "", euroFormatter.format(total)),
      accountName ? ` · ${isBuy ? "taken from" : "paid into"} ${accountName}` : " · no account changes");
  }
  const sharesHeld = getSharesHeld(ticker);
  if (ticker && sharesHeld && !tradeBeingEdited) totalLine.append(`${totalLine.textContent ? " · " : ""}you hold ${shareCountFormatter.format(sharesHeld)} ${ticker}`);
}

// The form's values in the shape the API expects
function readTradeForm(form) {
  const formValues = Object.fromEntries(new FormData(form));
  return {
    side: formValues.side,
    ticker: formValues.ticker,
    shares: Number(formValues.shares),
    price: Number(formValues.price),
    fees: formValues.fees === "" ? 0 : Number(formValues.fees),
    date: formValues.date || null,
    account_id: formValues.account_id ? Number(formValues.account_id) : null,
    note: formValues.note || null,
  };
}

async function saveTrade(event) {
  event.preventDefault();
  const trade = readTradeForm(event.target);
  const pickedAccountId = new FormData(event.target).get("account_id");
  try {
    if (tradeBeingEdited) await callApi(`/investments/trades/${tradeBeingEdited.id}`, { method: "PUT", body: trade });
    else await callApi("/investments/trades", { method: "POST", body: trade });
  } catch (error) {
    elementById("trade-error").textContent = error.message; // the dialog stays open to fix it
    return;
  }
  if (!tradeBeingEdited) localStorage.setItem("tradeAccount", pickedAccountId ?? "");
  const [nextTrade, ...tradesAfterTheNext] = tradesWaitingToBeRecorded;
  elementById("trade-dialog").close(); // closing clears the sequence (see initializeTradeDialog): it's put back below
  loadAllData();
  if (nextTrade) {
    tradesWaitingToBeRecorded = tradesAfterTheNext;
    openTradeDialog(nextTrade);
  }
}

// Several new trades to check and save one after another: the dialog opens again for the next one after each
// save. Closing it any other way (Cancel, Escape, a click outside) stops the sequence.
export function openTradeDialogsOneAfterAnother(trades) {
  if (!trades.length) return;
  openTradeDialog(trades[0]);
  tradesWaitingToBeRecorded = trades.slice(1);
  updateTradeDialogTexts();
}

async function deleteTradeBeingEdited() {
  const trade = tradeBeingEdited;
  if (!trade) return;
  const isBuy = trade.side === "buy";
  const moneyNote = trade.account ? `\n\n${euroFormatter.format(trade.amount)} goes back ${isBuy ? "to" : "out of"} ${trade.account}.` : "";
  if (!confirm(`Delete this ${isBuy ? "buy" : "sale"} of ${shareCountFormatter.format(trade.shares)} ${trade.ticker} from ${trade.date}?\n\nThe holding is recalculated.${moneyNote}`)) return;
  try {
    await callApi(`/investments/trades/${trade.id}`, { method: "DELETE" });
  } catch (error) {
    elementById("trade-error").textContent = error.message;
    return;
  }
  elementById("trade-dialog").close();
  loadAllData();
}

export function initializeTradeDialog() {
  ["input", "change"].forEach((eventName) => elementById("trade-form").addEventListener(eventName, updateTradeDialogTexts));
  elementById("trade-new").addEventListener("click", () => openTradeDialog());
  elementById("trade-form").addEventListener("submit", saveTrade);
  elementById("trade-delete").addEventListener("click", deleteTradeBeingEdited);
  elementById("trade-dialog").addEventListener("close", () => {
    tradeBeingEdited = null;
    tradesWaitingToBeRecorded = [];
  });
}
