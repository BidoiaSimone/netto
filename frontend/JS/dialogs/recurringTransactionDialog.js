// ---- recurring transaction dialog: adds a rule, or edits / pauses / deletes one ----
// The same <dialog id="recurring-dialog"> does both: switchRecurringDialogMode() changes its title and buttons.

import { elementById } from "../core/domHelpers.js";
import { euroFormatter, formatShortDate, getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { loadAllData } from "../core/dataRefresh.js";
import { addClosedAccountOptionIfMissing } from "../core/accountPickers.js";
import { fillCategoryPicker } from "../core/categoryPickers.js";
import { getOccurrenceDate, listUpcomingDates, describeRepeat } from "../core/recurrenceDates.js";
import { openDialog } from "../app/dialogWindows.js";

const NUMBER_OF_DATES_PREVIEWED = 3;

// "Every month on the 5th" -> "every month on the 5th" (to read inside a sentence; weekdays keep their capital)
const lowercaseFirstLetter = (text) => text.charAt(0).toLowerCase() + text.slice(1);

let ruleBeingEdited = null; // null when adding a new one

export function switchRecurringDialogMode(ruleToEdit) {
  ruleBeingEdited = ruleToEdit;
  elementById("recurring-title").textContent = ruleToEdit ? "Edit recurring transaction" : "New recurring transaction";
  elementById("recurring-submit").textContent = ruleToEdit ? "Save changes" : "Add";
  elementById("recurring-delete").hidden = !ruleToEdit;
  elementById("recurring-paused-field").hidden = !ruleToEdit;
  document.querySelector("#recurring-dialog .recurring-edit-note").hidden = !ruleToEdit;
  elementById("recurring-error").textContent = "";
}

// A new rule starts today, every month
export function prepareNewRecurringTransaction() {
  switchRecurringDialogMode(null);
  const form = elementById("recurring-form");
  form.reset();
  form.start_date.value = getTodayAsLocalDate();
  form.repeat_interval.value = 1;
  form.repeat_unit.value = "month";
  updateRecurringDialog();
}

export function openRecurringTransactionEditor(rule) {
  openDialog("recurring-dialog");
  switchRecurringDialogMode(rule);
  const form = elementById("recurring-form");
  addClosedAccountOptionIfMissing(elementById("rec-from"), rule.from_account_id);
  addClosedAccountOptionIfMissing(elementById("rec-to"), rule.to_account_id);
  form.type.value = rule.type;
  form.amount.value = rule.amount;
  form.from_account_id.value = rule.from_account_id ?? "";
  form.to_account_id.value = rule.to_account_id ?? "";
  form.description.value = rule.description ?? "";
  form.repeat_interval.value = rule.repeat_interval;
  form.repeat_unit.value = rule.repeat_unit;
  form.start_date.value = rule.start_date;
  form.end_date.value = rule.end_date ?? "";
  form.paused.checked = rule.paused;
  updateRecurringDialog(); // fills the category list for this type: pick the category after it
  form.category_id.value = rule.category_id ?? "";
  form.amount.focus();
}

// The form's values in the shape the API expects
function readRecurringForm() {
  const form = elementById("recurring-form");
  return {
    type: form.type.value,
    amount: Number(form.amount.value),
    from_account_id: form.from_account_id.value ? Number(form.from_account_id.value) : null,
    to_account_id: form.to_account_id.value ? Number(form.to_account_id.value) : null,
    category_id: form.category_id.value ? Number(form.category_id.value) : null,
    description: form.description.value || null,
    repeat_interval: Number(form.repeat_interval.value),
    repeat_unit: form.repeat_unit.value,
    start_date: form.start_date.value,
    end_date: form.end_date.value || null,
    paused: form.paused.checked,
  };
}

// Income only has a destination, expense only a source, movement has both (like a normal transaction);
// income and expense each have their own categories
function updateAccountAndCategoryFieldsForType() {
  const type = elementById("rec-type").value;
  fillCategoryPicker(elementById("rec-category"), type);
  const fromAccountPicker = elementById("rec-from"), toAccountPicker = elementById("rec-to");
  fromAccountPicker.disabled = type === "income";
  toAccountPicker.disabled = type === "expense";
  fromAccountPicker.required = type !== "income";
  toAccountPicker.required = type !== "expense";
}

// The units say "week" or "weeks" depending on the number in front of them
function updateRepeatUnitLabels() {
  const isPlural = Number(elementById("recurring-form").repeat_interval.value) !== 1;
  for (const option of elementById("rec-unit").options) option.textContent = option.value + (isPlural ? "s" : "");
}

// The preset chips light up when the fields match them
function highlightMatchingPreset(schedule) {
  for (const chip of elementById("rec-presets").children) {
    chip.classList.toggle("active", chip.dataset.unit === schedule.repeat_unit && Number(chip.dataset.interval) === schedule.repeat_interval);
  }
}

// "Every month on the 5th · next: 5 nov 26, 5 dic 26, 5 gen 27" and, for a new rule starting in the past,
// how many past dates will be added straight away
function updatePreview(schedule) {
  const preview = elementById("recurring-preview");
  if (!schedule.start_date || !(schedule.repeat_interval >= 1)) {
    preview.textContent = "";
    return;
  }
  const today = getTodayAsLocalDate();
  const upcomingDates = listUpcomingDates(schedule, today, NUMBER_OF_DATES_PREVIEWED);
  const upcomingText = upcomingDates.length ? `next: ${upcomingDates.map((date) => formatShortDate(date, true)).join(", ")}` : "no more dates";
  let pastDatesText = "";
  if (!ruleBeingEdited) {
    let pastDateCount = 0;
    while (pastDateCount < 1000 && getOccurrenceDate(schedule, pastDateCount) < today
           && (!schedule.end_date || getOccurrenceDate(schedule, pastDateCount) <= schedule.end_date)) pastDateCount++;
    if (pastDateCount) pastDatesText = ` · ${pastDateCount} past date${pastDateCount === 1 ? "" : "s"} will be added right away`;
  }
  const amount = Number(elementById("recurring-form").amount.value);
  const amountText = amount > 0 ? `${euroFormatter.format(amount)} ` : "";
  preview.textContent = `${amountText}${lowercaseFirstLetter(describeRepeat(schedule))} · ${upcomingText}${pastDatesText}`;
}

function updateRecurringDialog() {
  const rule = readRecurringForm();
  updateAccountAndCategoryFieldsForType();
  updateRepeatUnitLabels();
  highlightMatchingPreset(rule);
  updatePreview(rule);
}

async function saveRecurringTransaction(event) {
  event.preventDefault();
  const rule = readRecurringForm();
  try {
    if (ruleBeingEdited) await callApi(`/recurring-transactions/${ruleBeingEdited.id}`, { method: "PUT", body: rule });
    else await callApi("/recurring-transactions", { method: "POST", body: rule });
  } catch (error) {
    elementById("recurring-error").textContent = error.message; // the dialog stays open to fix it
    return;
  }
  elementById("recurring-dialog").close();
  loadAllData();
}

async function deleteRecurringTransactionBeingEdited() {
  const rule = ruleBeingEdited;
  if (!rule) return;
  const name = rule.description || lowercaseFirstLetter(describeRepeat(rule));
  if (!confirm(`Delete "${name}"?\n\nNo more transactions will be added. The ones it already added stay.`)) return;
  try {
    await callApi(`/recurring-transactions/${rule.id}`, { method: "DELETE" });
  } catch (error) {
    elementById("recurring-error").textContent = error.message;
    return;
  }
  elementById("recurring-dialog").close();
  loadAllData();
}

export function initializeRecurringTransactionDialog() {
  const form = elementById("recurring-form");
  ["input", "change"].forEach((eventName) => form.addEventListener(eventName, updateRecurringDialog));
  elementById("rec-presets").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-unit]");
    if (!chip) return;
    form.repeat_unit.value = chip.dataset.unit;
    form.repeat_interval.value = chip.dataset.interval;
    updateRecurringDialog();
  });
  form.addEventListener("submit", saveRecurringTransaction);
  elementById("recurring-delete").addEventListener("click", deleteRecurringTransactionBeingEdited);
  elementById("recurring-dialog").addEventListener("close", () => { ruleBeingEdited = null; });
}
