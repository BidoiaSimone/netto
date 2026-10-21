// ---- Categories page: expense and income categories, each list with its add / rename (or merge) / delete ----
// Each name is an input: edit it and press Enter (or click away) to rename.
// Expense categories also have a monthly budget field: type a limit, Enter (empty = no budget). PUT /categories/:id/budget
// saves it from this month on, earlier months keep their own (migration 11).
// They are also habitual or one-off (migration 16, stored as spending_pace "daily" / "occasional"):
// habitual ones (groceries) get the rest of the month projected at the pace so far on Insights, one-off ones
// (gifts, a new phone) count only what's spent. PUT /categories/:id/spending-pace
// Each category also has an icon and a colour (migration 21), shown in the transaction lists: the round button
// before its name opens the picker (dialogs/categoryLookDialog.js). PUT /categories/:id/look
// The "Add" forms have the same button; it starts with a guess from the name typed (core/categoryIcons.js).
// The category lists also feed the transaction and recurring forms and the category filter.
// netto light has no budgets and no projections, so its expense list has neither column (core/edition.js).

import { elementById, createElement, fillTableBody, hideAmountFieldWhenAmountsHidden } from "../core/domHelpers.js";
import { formatCount, euroFormatter } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { runThenReloadAllData } from "../core/dataRefresh.js";
import { fillCategoryPicker, fillCategoryFilter } from "../core/categoryPickers.js";
import { renderMonthProjection } from "./monthProjection.js";
import { isLightEdition } from "../core/edition.js";
import { renderTransactionsPage } from "./transactionsPage.js";
import { createCategoryIcon, guessCategoryLook } from "../core/categoryIcons.js";
import { openCategoryLookPicker } from "../dialogs/categoryLookDialog.js";
import { renderTransactionCategoryChips } from "../dialogs/transactionCategoryChips.js";
import { renderLatestTransactions } from "./homePage.js";
import { renderInsightsPage } from "./insightsPage.js";
import { renderQuickAdd } from "./quickAdd.js";
import { renderRecurringPage } from "./recurringPage.js";
import { redrawBudgetProgress } from "./budgetProgress.js";
import { renderCategoryTrends } from "./categoryTrends.js";
import { renderGoalsPage } from "./goalsPage.js";

const CATEGORY_KINDS = ["expense", "income"];
const tableBodyIdForKind = (kind) => `${kind}-categories-body`;

export async function loadCategories() {
  appState.categories = await callApi("/categories");
  renderCategoriesPage();
  // every list with category icons draws again: they may have arrived before the categories did
  renderTransactionsPage();
  renderLatestTransactions();
  renderInsightsPage();
  renderQuickAdd();
  if (appState.recurringTransactions.length) renderRecurringPage(); // before they load, it would say "none yet"
  if (!isLightEdition) {
    redrawBudgetProgress();
    renderCategoryTrends();
    renderGoalsPage();
  }
  fillCategoryPicker(elementById("tx-category"), elementById("tx-type").value);
  renderTransactionCategoryChips();
  fillCategoryPicker(elementById("rec-category"), elementById("rec-type").value);
  fillCategoryFilter();
  if (!isLightEdition) renderMonthProjection(); // it needs to know which categories are one-off
}

function renderCategoriesPage() {
  // an auto refresh must not wipe a name you are in the middle of typing (a focused icon button is fine: the picker
  // gives it the focus back when it closes, and the new icon must show)
  if (document.activeElement?.closest(".categories-list tbody") && document.activeElement.matches("input, select")) return;

  for (const kind of CATEGORY_KINDS) {
    const categoriesOfKind = appState.categories.filter((category) => category.kind === kind);
    fillTableBody(tableBodyIdForKind(kind), categoriesOfKind, (category) => [
      createNameCell(category),
      ...(kind === "expense" && !isLightEdition ? [createBudgetInput(category), createSpendingPacePicker(category)] : []),
      createUseCell(category),
      createCategoryActions(category),
    ]);
  }
  if (!isLightEdition) renderBudgetsTotal();
}

// "Budgets: 1.250,00 € a month across 4 categories"
function renderBudgetsTotal() {
  const budgetedCategories = appState.categories.filter((category) => category.kind === "expense" && category.monthly_budget !== null);
  const totalOfBudgets = budgetedCategories.reduce((sum, category) => sum + Math.round(category.monthly_budget * 100), 0) / 100; // in cents: no float drift
  elementById("budgets-total").textContent = budgetedCategories.length
    ? `Budgets: ${euroFormatter.format(totalOfBudgets)} a month across ${budgetedCategories.length} ${budgetedCategories.length === 1 ? "category" : "categories"}`
    : "No budgets yet.";
}

// The monthly limit of an expense category. Saved when you leave the field or press Enter; Escape puts it back.
function createBudgetInput(category) {
  const budgetInput = createElement("input", "budget-input");
  budgetInput.type = "number";
  budgetInput.min = "0";
  budgetInput.step = "0.01";
  budgetInput.placeholder = "budget"; // empty: no budget (short, so it fits the phone's narrower field)
  budgetInput.title = "Monthly budget: empty = no budget";
  budgetInput.value = category.monthly_budget ?? "";
  budgetInput.setAttribute("aria-label", `${category.name}: monthly budget in euros`);
  budgetInput.addEventListener("change", () => {
    const newLimit = budgetInput.value === "" ? null : Number(budgetInput.value);
    if (newLimit === category.monthly_budget) return;
    runThenReloadAllData(() => callApi(`/categories/${category.id}/budget`, { method: "PUT", body: { monthly_limit: newLimit } }));
  });
  budgetInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") budgetInput.blur(); // blur fires "change"
    if (event.key === "Escape") { budgetInput.value = category.monthly_budget ?? ""; budgetInput.blur(); }
  });
  hideAmountFieldWhenAmountsHidden(budgetInput);
  return budgetInput;
}

// "habitual" / "one-off": how the month projections on Insights treat this category. Saved as soon as it changes.
function createSpendingPacePicker(category) {
  const pacePicker = createElement("select", "pace-select");
  pacePicker.append(new Option("habitual", "daily"), new Option("one-off", "occasional"));
  pacePicker.value = category.spending_pace;
  pacePicker.setAttribute("aria-label", `${category.name}: habitual or one-off`);
  pacePicker.title = "Habitual: bought all month long, Insights projects the rest of the month at this month's pace (groceries, coffee).\n"
    + "One-off: bought once in a while, only what's already spent counts (gifts, a new phone).";
  pacePicker.addEventListener("change", () =>
    runThenReloadAllData(() => callApi(`/categories/${category.id}/spending-pace`, { method: "PUT", body: { spending_pace: pacePicker.value } })));
  return pacePicker;
}

// The "Used by" cell, kept short so it never wraps: "3 transactions · ↻ 1" (the full sentence is in its tooltip)
function createUseCell(category) {
  const parts = [];
  if (category.used) parts.push(formatCount(category.used, "transaction"));
  if (category.used_by_recurring) parts.push(`↻ ${category.used_by_recurring}`);
  const useCell = createElement("span", "category-use", parts.length ? parts.join(" · ") : "not used yet");
  useCell.title = describeUse(category);
  return useCell;
}

// "3 transactions · 1 recurring", or "not used yet"
function describeUse(category) {
  const uses = [];
  if (category.used) uses.push(formatCount(category.used, "transaction"));
  if (category.used_by_recurring) uses.push(`${category.used_by_recurring} recurring`);
  return uses.length ? uses.join(" · ") : "not used yet";
}

// The icon button and the name, in one cell (so the phone layout of 31-phone.css keeps its cell numbers)
function createNameCell(category) {
  const nameCell = createElement("span", "category-name-cell");
  nameCell.append(createLookButton(category), createCategoryNameInput(category));
  return nameCell;
}

// The category's round icon, as a button that opens the picker; the choice is saved at once
function createLookButton(category) {
  const lookButton = createElement("button", "category-look-button");
  lookButton.type = "button";
  lookButton.title = "Change icon and colour";
  lookButton.setAttribute("aria-label", `${category.name}: icon and colour`);
  lookButton.append(createCategoryIcon(category, "category-icon"));
  lookButton.addEventListener("click", () => openCategoryLookPicker(category, (look) => {
    if (look.icon === category.icon && look.color === category.color) return;
    runThenReloadAllData(() => callApi(`/categories/${category.id}/look`, { method: "PUT", body: look }));
  }));
  return lookButton;
}

function createCategoryNameInput(category) {
  const nameInput = createElement("input");
  nameInput.value = category.name;
  nameInput.setAttribute("aria-label", `${category.kind} category name`);
  nameInput.addEventListener("change", () => {
    const newName = nameInput.value.trim();
    if (!newName || newName === category.name) {
      nameInput.value = category.name;
      return;
    }
    renameCategory(category, newName);
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") nameInput.blur(); // blur fires "change"
    if (event.key === "Escape") { nameInput.value = category.name; nameInput.blur(); }
  });
  return nameInput;
}

// The button at the end of each row: "Delete" (a category stays an expense or an income one: no moving between lists)
function createCategoryActions(category) {
  const actions = createElement("span", "category-actions");
  actions.append(createDeleteCategoryButton(category));
  return actions;
}

function createDeleteCategoryButton(category) {
  const deleteButton = createElement("button", "", "Delete");
  deleteButton.type = "button";
  deleteButton.onclick = () => {
    const confirmation = category.used || category.used_by_recurring
      ? `Delete "${category.name}"? Its ${describeUse(category)} will become uncategorized.`
      : `Delete "${category.name}"?`;
    if (confirm(confirmation)) runThenReloadAllData(() => callApi(`/categories/${category.id}`, { method: "DELETE" }));
  };
  return deleteButton;
}

// If the new name already exists (in the same kind), the server answers 409 + merge_into: ask, then merge
function renameCategory(category, newName) {
  runThenReloadAllData(async () => {
    try {
      await callApi(`/categories/${category.id}`, { method: "PUT", body: { name: newName } });
    } catch (error) {
      const mergeTarget = error.data?.merge_into;
      if (!mergeTarget) throw error;
      const movingTransactions = category.used ? ` Its ${formatCount(category.used, "transaction")} will move to "${mergeTarget.name}".` : "";
      if (!confirm(`"${mergeTarget.name}" already exists. Merge "${category.name}" into it?${movingTransactions}`)) return; // the reload puts the old name back
      await callApi(`/categories/${category.id}`, { method: "PUT", body: { name: newName, merge: true } });
    }
  });
}

// The "Add" form above each list; its data-kind says which list it adds to.
// Its round button shows the icon and colour the new category will get: a guess from the name as you type it,
// until you pick one yourself with the button (then the name no longer changes it).
export function initializeCategoriesPage() {
  for (const form of document.querySelectorAll(".category-add-form")) {
    const lookButton = form.querySelector(".category-look-button");
    let newLook = { icon: null, color: null }, isPickedByHand = false;
    const showNewLook = () => {
      const name = form.elements.name.value;
      lookButton.replaceChildren(createCategoryIcon({ name, ...newLook }, `category-icon${name.trim() || newLook.icon ? "" : " is-empty"}`));
    };
    const startOver = () => {
      newLook = { icon: null, color: null };
      isPickedByHand = false;
      showNewLook();
    };

    form.elements.name.addEventListener("input", () => {
      if (!isPickedByHand) newLook = guessCategoryLook(form.elements.name.value);
      showNewLook();
    });
    lookButton.addEventListener("click", () => openCategoryLookPicker({ name: form.elements.name.value, ...newLook }, (look) => {
      newLook = look;
      isPickedByHand = true;
      showNewLook();
      form.elements.name.focus();
    }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = form.elements.name.value;
      runThenReloadAllData(async () => {
        await callApi("/categories", { method: "POST", body: { name, kind: form.dataset.kind, ...newLook } });
        form.reset();
        startOver();
      });
    });
    startOver();
  }
}
