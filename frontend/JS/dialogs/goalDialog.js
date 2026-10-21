// ---- goal dialog: adds a goal, or edits / deletes one (Goals page) ----
// Every expense category is listed with a tick box and its baseline: what it normally costs a month. The baselines
// start as the server's suggestion (GET /savings-goals/baselines: your average of recent months, leaving out the
// months a goal was cutting back on that category) and can be typed over; once the goal is saved they stay as
// they are, so cutting back can't lower them. Under each name, where its suggestion comes from.

import { elementById, createElement } from "../core/domHelpers.js";
import { euroFormatter, getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { loadAllData } from "../core/dataRefresh.js";
import { createCategoryIcon } from "../core/categoryIcons.js";

let goalBeingEdited = null; // null when adding a new one

// "about 9 months", "about 1 year and 2 months"
function describeMonths(months) {
  const rounded = Math.max(1, Math.round(months));
  const years = Math.floor(rounded / 12), rest = rounded % 12;
  const monthText = (count) => `${count} month${count === 1 ? "" : "s"}`;
  if (!years) return `about ${monthText(rounded)}`;
  return `about ${years} year${years === 1 ? "" : "s"}${rest ? ` and ${monthText(rest)}` : ""}`;
}

// One row per expense category: [✓] Coffee  [ 60,00 ] € a month
// Where a suggested baseline comes from: "average of 4 months (2 goal months left out)", "from MacBook", "12 days, rough"
function describeSuggestionSource(suggested) {
  if (!suggested) return "";
  const skipped = suggested.skipped_goal_months
    ? ` (${suggested.skipped_goal_months} goal month${suggested.skipped_goal_months === 1 ? "" : "s"} left out)` : "";
  if (suggested.based_on === "months") return `average of ${suggested.months} month${suggested.months === 1 ? "" : "s"}${skipped}`;
  if (suggested.based_on === "goal") return `same as ${suggested.goal_name} (no month without a goal yet)`;
  return `${suggested.days} day${suggested.days === 1 ? "" : "s"} of records, scaled: rough`;
}

// One row per expense category: [✓] Coffee            [ 60,00 ] €/month
//                                    average of 6 months
function fillCategoryRows(suggestion, goal) {
  const suggestedById = new Map(suggestion.categories.map((category) => [category.category_id, category]));
  const chosenById = new Map((goal?.categories ?? []).map((category) => [category.category_id, category.monthly_baseline]));
  const expenseCategories = appState.categories
    .filter((category) => category.kind === "expense")
    .sort((first, second) => first.name.localeCompare(second.name));

  elementById("goal-categories").replaceChildren(...expenseCategories.map((category) => {
    const isChosen = chosenById.has(category.id);
    const suggested = suggestedById.get(category.id);
    const row = createElement("label", "goal-category-row");
    const tickBox = createElement("input");
    tickBox.type = "checkbox";
    tickBox.checked = isChosen;
    tickBox.dataset.categoryId = category.id;
    const baselineInput = createElement("input", "goal-baseline");
    Object.assign(baselineInput, { type: "number", step: "0.01", min: "0", inputMode: "decimal", disabled: !isChosen });
    baselineInput.value = isChosen ? chosenById.get(category.id) : (suggested?.monthly_average ?? 0);
    baselineInput.setAttribute("aria-label", `${category.name}: what it normally costs a month`);
    tickBox.addEventListener("change", () => { baselineInput.disabled = !tickBox.checked; });
    const name = createElement("span", "goal-category-name", category.name);
    // the suggestion stays readable under the name, whatever is typed in the box
    const suggestedAmount = suggested ? `suggested ${euroFormatter.format(suggested.monthly_average)}` : "";
    const source = isChosen
      ? (!suggested ? ""
        : suggested.based_on === "goal" ? "no month without a goal yet: nothing to compare with" // it would only repeat this goal's own number
        : `netto suggests ${euroFormatter.format(suggested.monthly_average)} (${describeSuggestionSource(suggested)})`)
      : [suggestedAmount, describeSuggestionSource(suggested)].filter(Boolean).join(" · ");
    if (source) name.append(" ", createElement("small", "hint goal-baseline-source", source)); // the space: still readable where the line doesn't break
    row.append(tickBox, createCategoryIcon(category, "category-icon small"), name, baselineInput, createElement("span", "hint", "€/month"));
    return row;
  }));

  elementById("goal-baseline-note").textContent = goal
    ? "Baselines as you set them when you made the goal. Changing one changes every month already counted."
    : "Suggested from what each category cost in recent months when no goal was cutting back on it. "
      + "If you've been holding back anyway, type over them with what you'd normally spend. Fixed once saved.";
}

// The form's values in the shape the API expects
function readGoalForm() {
  const form = elementById("goal-form");
  const categories = [...elementById("goal-categories").querySelectorAll(".goal-category-row")]
    .filter((row) => row.querySelector("input[type=checkbox]").checked)
    .map((row) => ({
      category_id: Number(row.querySelector("input[type=checkbox]").dataset.categoryId),
      monthly_baseline: Number(row.querySelector(".goal-baseline").value || 0),
    }));
  const target = goalBeingEdited?.purchase ? goalBeingEdited.planned_target : Number(form.target.value);
  return { name: form.name.value, target, start_date: form.start_date.value, categories };
}

// "Cutting back from 140 € a month: spending nothing there takes about 9 months, half of it about 1 year and 7 months"
function updatePreview() {
  const goal = readGoalForm();
  const baselineTotal = goal.categories.reduce((sum, category) => sum + category.monthly_baseline, 0);
  const preview = elementById("goal-preview");
  goal.target = Number(elementById("goal-form").target.value); // what's shown: the price, once it's bought
  if (!(goal.target > 0) || !(baselineTotal > 0)) {
    preview.textContent = goal.categories.length ? "" : "Tick the categories you'll cut back on.";
    return;
  }
  preview.textContent = `Cutting back from ${euroFormatter.format(baselineTotal)} a month: spending nothing there takes `
    + `${describeMonths(goal.target / baselineTotal)}, half of it ${describeMonths(goal.target / (baselineTotal / 2))}.`;
}

// goal: one from GET /savings-goals, or nothing for a new one
export async function openGoalEditor(goal = null) {
  goalBeingEdited = goal;
  const form = elementById("goal-form");
  form.reset();
  elementById("goal-title").textContent = goal ? `Edit ${goal.name}` : "New goal";
  elementById("goal-submit").textContent = goal ? "Save changes" : "Add goal";
  elementById("goal-delete").hidden = !goal;
  elementById("goal-error").textContent = "";
  form.name.value = goal?.name ?? "";
  // bought: the target is the purchase's price, set by netto; the one you planned is kept for if it's unlinked
  form.target.value = goal?.target ?? "";
  form.target.disabled = Boolean(goal?.purchase);
  form.target.previousElementSibling.textContent = goal?.purchase ? "Target (€): the price you paid" : "Target (€)";
  form.target.title = goal?.purchase ? "The price of the linked purchase: unlink it to change the target" : "";
  form.start_date.value = goal?.start_date ?? getTodayAsLocalDate();

  let suggestion = { categories: [] };
  try {
    suggestion = await callApi("/savings-goals/baselines");
  } catch (error) {
    elementById("goal-error").textContent = error.message;
  }
  fillCategoryRows(suggestion, goal);
  updatePreview();
  elementById("goal-dialog").showModal();
  form.name.focus();
}

async function saveGoal(event) {
  event.preventDefault();
  const goal = readGoalForm();
  try {
    if (goalBeingEdited) await callApi(`/savings-goals/${goalBeingEdited.id}`, { method: "PUT", body: goal });
    else await callApi("/savings-goals", { method: "POST", body: goal });
  } catch (error) {
    elementById("goal-error").textContent = error.message; // the dialog stays open to fix it
    return;
  }
  elementById("goal-dialog").close();
  loadAllData();
}

async function deleteGoalBeingEdited() {
  const goal = goalBeingEdited;
  if (!goal || !confirm(`Delete the goal "${goal.name}"?\n\nNo transaction changes: only the goal and its progress go.`)) return;
  try {
    await callApi(`/savings-goals/${goal.id}`, { method: "DELETE" });
  } catch (error) {
    elementById("goal-error").textContent = error.message;
    return;
  }
  elementById("goal-dialog").close();
  loadAllData();
}

export function initializeGoalDialog() {
  const form = elementById("goal-form");
  ["input", "change"].forEach((eventName) => form.addEventListener(eventName, updatePreview));
  form.addEventListener("submit", saveGoal);
  elementById("goal-delete").addEventListener("click", deleteGoalBeingEdited);
  elementById("goal-add").addEventListener("click", () => openGoalEditor());
  elementById("goal-dialog").addEventListener("close", () => { goalBeingEdited = null; });
}
