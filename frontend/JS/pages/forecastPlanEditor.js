// ---- Forecast page: editing the plan (phases, one-off events, assumptions) ----
// Like the categories, every row is editable in place: change a field and leave it (or press Enter) and it's
// saved. Each save answers with the whole new forecast, handed to forecastPage.js to redraw (onForecastChanged).
// The sliders save while you move them, a moment after you stop, so the chart follows your hand.

import { elementById, createElement, fillTableBody, highlightSelectedChip, hideAmountFieldWhenAmountsHidden } from "../core/domHelpers.js";
import { euroFormatter } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";

const SLIDER_SAVE_DELAY_MILLISECONDS = 250;
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });

let onForecastChanged = () => {};
let getYearsShown = () => 10;

// Sends a change to the plan and shows the forecast it answers with. Errors go to the line under the plan.
async function changePlan(path, method, body) {
  elementById("fc-error").textContent = "";
  try {
    onForecastChanged(await callApi(`${path}?years=${getYearsShown()}`, { method, body }));
    return true;
  } catch (error) {
    elementById("fc-error").textContent = error.message;
    return false;
  }
}

// ---------- an editable cell ----------

// An input that saves the whole row (rowToBody with this field changed) when it's changed
function createEditableCell(row, fieldName, { type = "text", step, rowToBody, path, ariaLabel }) {
  const input = createElement("input", `fc-${fieldName}`);
  input.type = type;
  if (step) input.step = step;
  if (type === "month") input.placeholder = "YYYY-MM";
  input.value = row[fieldName] ?? "";
  input.setAttribute("aria-label", ariaLabel);
  input.addEventListener("change", () => changePlan(path, "PUT", { ...rowToBody(row), [fieldName]: input.value }));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur(); // blur fires "change"
    if (event.key === "Escape") { input.value = row[fieldName] ?? ""; input.blur(); }
  });
  if (type === "number") hideAmountFieldWhenAmountsHidden(input); // income, expenses, an event's amount
  return input;
}

function createDeleteButton(confirmation, path) {
  const deleteButton = createElement("button", "", "Delete");
  deleteButton.type = "button";
  deleteButton.onclick = () => { if (confirm(confirmation)) changePlan(path, "DELETE"); };
  return deleteButton;
}

// "mar 2028"
const formatMonth = (yearMonth) => new Date(yearMonth + "-01T00:00").toLocaleDateString("it-IT", { month: "short", year: "numeric" });

// ---------- phases ----------

const phaseToBody = (phase) => ({ name: phase.name, from_month: phase.from_month, monthly_income: phase.monthly_income, monthly_expenses: phase.monthly_expenses });

function renderPhases(forecast) {
  fillTableBody("fc-phases-body", forecast.phases, (phase) => {
    const path = `/forecast/phases/${phase.id}`;
    const savings = phase.monthly_income - phase.monthly_expenses;
    return [
      createEditableCell(phase, "name", { rowToBody: phaseToBody, path, ariaLabel: "Phase name" }),
      createEditableCell(phase, "from_month", { type: "month", rowToBody: phaseToBody, path, ariaLabel: `${phase.name}: starts in` }),
      phase.until_month ? formatMonth(phase.until_month) : "and after",
      createEditableCell(phase, "monthly_income", { type: "number", step: "0.01", rowToBody: phaseToBody, path, ariaLabel: `${phase.name}: income per month` }),
      createEditableCell(phase, "monthly_expenses", { type: "number", step: "0.01", rowToBody: phaseToBody, path, ariaLabel: `${phase.name}: expenses per month` }),
      createElement("span", savings > 0 ? "pos" : savings < 0 ? "neg" : "", `${savings > 0 ? "+" : savings < 0 ? "−" : ""}${euroFormatter.format(Math.abs(savings))}`),
      createDeleteButton(`Delete the phase "${phase.name}"?`, path),
    ];
  });
  renderSuggestion(forecast);
}

// With no phases saved, the forecast uses one suggested from your real numbers: say where it comes from, and
// offer to keep it as the first phase (then it can be renamed "Master's" and edited like any other)
function renderSuggestion(forecast) {
  const suggestionBox = elementById("fc-suggestion");
  suggestionBox.hidden = !forecast.suggested_phase;
  if (!forecast.suggested_phase) return;
  const { monthly_income: income, monthly_expenses: expenses } = forecast.suggested_phase;
  const keepButton = createElement("button", "", "Use as my first phase");
  keepButton.type = "button";
  keepButton.onclick = () => changePlan("/forecast/phases", "POST", { ...forecast.suggested_phase, name: "Now" });
  suggestionBox.replaceChildren(
    createElement("strong", "", `Suggested from your numbers: ${euroFormatter.format(income)} in, ${euroFormatter.format(expenses)} out a month`),
    createElement("p", "hint small", `${forecast.averages.source} The forecast below already uses it; keep it as your first phase to rename and change it.`),
    keepButton,
  );
}

// ---------- events ----------

// What an event is linked to, as one dropdown value: "" (money from/to outside), "investments" (money moving
// between cash and investments: − buys, + sells) or a personal-use asset's account id (the event sells it).
// The API keeps these as two fields, sells_account_id and transfers_with_investments (only one can be set).
const INVESTMENTS_LINK = "investments";
const linkOfEvent = (event) => (event.transfers_with_investments ? INVESTMENTS_LINK : event.sells_account_id ?? "");
const linkToBody = (link) => ({
  sells_account_id: link === INVESTMENTS_LINK || link === "" ? null : link,
  transfers_with_investments: link === INVESTMENTS_LINK,
});
const eventToBody = (event) => ({ name: event.name, month: event.month, amount: event.amount, ...linkToBody(linkOfEvent(event)) });

// The dropdown of what an event can be linked to (also the one in the "add" row)
function createLinkPicker(forecast, selectedLink) {
  const picker = createElement("select");
  picker.append(
    new Option("— nothing (money in or out) —", ""),
    new Option("Investments (− buys, + sells)", INVESTMENTS_LINK),
    ...forecast.personal_use_assets.map((asset) => new Option(`Sells ${asset.name} (${euroFormatter.format(asset.value)})`, asset.account_id)),
  );
  picker.value = selectedLink ?? "";
  return picker;
}

function renderEvents(forecast) {
  fillTableBody("fc-events-body", forecast.events, (event) => {
    const path = `/forecast/events/${event.id}`;
    const linkPicker = createLinkPicker(forecast, linkOfEvent(event));
    linkPicker.setAttribute("aria-label", `${event.name}: linked to`);
    linkPicker.addEventListener("change", () => changePlan(path, "PUT", { ...eventToBody(event), ...linkToBody(linkPicker.value) }));
    // a past event keeps its editable name, with a note: it isn't counted until it's moved to a future month
    const nameCell = createElement("span", event.is_past ? "fc-past-event" : "");
    nameCell.append(createEditableCell(event, "name", { rowToBody: eventToBody, path, ariaLabel: "Event name" }));
    if (event.is_past) nameCell.append(createElement("small", "hint fc-past-note", "in the past: not counted"));
    return [
      nameCell,
      createEditableCell(event, "month", { type: "month", rowToBody: eventToBody, path, ariaLabel: `${event.name}: month` }),
      createEditableCell(event, "amount", { type: "number", step: "0.01", rowToBody: eventToBody, path, ariaLabel: `${event.name}: amount` }),
      linkPicker,
      createDeleteButton(`Delete the event "${event.name}"?`, path),
    ];
  });
  const addFormPicker = elementById("fc-event-link"), pickedBefore = addFormPicker.value;
  addFormPicker.replaceChildren(...createLinkPicker(forecast, null).options);
  addFormPicker.value = pickedBefore;
}

// ---------- assumptions ----------

const SLIDERS = [
  { inputId: "fc-return", valueId: "fc-return-value", field: "yearly_return" },
  { inputId: "fc-inflation", valueId: "fc-inflation-value", field: "yearly_inflation" },
  { inputId: "fc-depreciation", valueId: "fc-depreciation-value", field: "yearly_depreciation" },
];

function renderAssumptions(forecast) {
  for (const slider of SLIDERS) {
    const input = elementById(slider.inputId);
    if (document.activeElement !== input) input.value = forecast.assumptions[slider.field]; // don't fight the hand on it
    elementById(slider.valueId).textContent = percentFormatter.format(Number(input.value));
  }
  highlightSelectedChip(elementById("fc-savings-go-to"), forecast.assumptions.savings_go_to);
}

// ---------- everything together ----------

// Redrawing a table rebuilds its inputs, which would wipe a value you are in the middle of typing. So while a
// field of the phases or events table has the focus, the newest forecast waits here, and the tables are drawn
// as soon as the focus leaves them. (Before, it was simply skipped: edit a phase, Tab to the next field, and
// "Until" and "Saves / month" stayed stale until the next refresh.)
const PLAN_TABLE_BODIES = "#fc-phases-body, #fc-events-body";
let forecastWaitingForFocusToLeave = null;

function renderPlanTables(forecast) {
  if (document.activeElement?.closest(PLAN_TABLE_BODIES)) { forecastWaitingForFocusToLeave = forecast; return; }
  forecastWaitingForFocusToLeave = null;
  renderPhases(forecast);
  renderEvents(forecast);
}

export function renderForecastPlan(forecast) {
  renderPlanTables(forecast);
  renderAssumptions(forecast);
}

export function initializeForecastPlanEditor(callbacks) {
  ({ onForecastChanged, getYearsShown } = callbacks);

  // the focus left the table (not just moved to another field in it): draw the forecast that was waiting.
  // "change" fires before "focusout", so the field you just left has already sent its save.
  for (const tableBody of document.querySelectorAll(PLAN_TABLE_BODIES)) {
    tableBody.addEventListener("focusout", (event) => {
      if (!forecastWaitingForFocusToLeave || event.relatedTarget?.closest(PLAN_TABLE_BODIES)) return;
      setTimeout(() => forecastWaitingForFocusToLeave && renderPlanTables(forecastWaitingForFocusToLeave));
    });
  }

  for (const slider of SLIDERS) {
    const input = elementById(slider.inputId);
    let saveTimer;
    input.addEventListener("input", () => {
      elementById(slider.valueId).textContent = percentFormatter.format(Number(input.value));
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => changePlan("/forecast/assumptions", "PUT", { [slider.field]: Number(input.value) }), SLIDER_SAVE_DELAY_MILLISECONDS);
    });
  }
  elementById("fc-savings-go-to").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (chip) changePlan("/forecast/assumptions", "PUT", { savings_go_to: chip.dataset.value });
  });

  const addFromForm = (formId, path, readBody) => {
    elementById(formId).addEventListener("submit", async (event) => {
      event.preventDefault();
      if (await changePlan(path, "POST", readBody(event.target.elements))) event.target.reset();
    });
  };
  addFromForm("fc-phase-form", "/forecast/phases", (fields) => ({
    name: fields.name.value, from_month: fields.from_month.value, monthly_income: fields.monthly_income.value, monthly_expenses: fields.monthly_expenses.value,
  }));
  addFromForm("fc-event-form", "/forecast/events", (fields) => ({
    name: fields.name.value, month: fields.month.value, amount: fields.amount.value, ...linkToBody(fields.linked_to.value),
  }));
}
