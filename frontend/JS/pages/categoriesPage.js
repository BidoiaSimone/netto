// ---- Categories page: expense and income categories, each list with its add / rename (or merge) / move / delete ----
// Each name is an input: edit it and press Enter (or click away) to rename.
// Expense categories also have a monthly budget field: type a limit, Enter (empty = no budget). PUT /categories/:id/budget
// saves it from this month on, earlier months keep their own (migration 11).
// The category lists also feed the transaction and recurring forms and the category filter.

import { elementById, createElement, fillTableBody } from "../core/domHelpers.js";
import { formatCount, euroFormatter } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { runThenReloadAllData } from "../core/dataRefresh.js";
import { fillCategoryPicker, fillCategoryFilter } from "../core/categoryPickers.js";

const CATEGORY_KINDS = ["expense", "income"];
const tableBodyIdForKind = (kind) => `${kind}-categories-body`;

export async function loadCategories() {
  appState.categories = await callApi("/categories");
  renderCategoriesPage();
  fillCategoryPicker(elementById("tx-category"), elementById("tx-type").value);
  fillCategoryPicker(elementById("rec-category"), elementById("rec-type").value);
  fillCategoryFilter();
}

function renderCategoriesPage() {
  // an auto refresh must not wipe a name you are in the middle of typing
  if (document.activeElement?.closest(".categories-list tbody")) return;

  for (const kind of CATEGORY_KINDS) {
    const categoriesOfKind = appState.categories.filter((category) => category.kind === kind);
    fillTableBody(tableBodyIdForKind(kind), categoriesOfKind, (category) => [
      createCategoryNameInput(category),
      ...(kind === "expense" ? [createBudgetInput(category)] : []),
      describeUse(category),
      createCategoryActions(category),
    ]);
  }
  renderBudgetsTotal();
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
  budgetInput.placeholder = "no budget";
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
  return budgetInput;
}

// "3 transactions · 1 recurring", or "not used yet"
function describeUse(category) {
  const uses = [];
  if (category.used) uses.push(formatCount(category.used, "transaction"));
  if (category.used_by_recurring) uses.push(`${category.used_by_recurring} recurring`);
  return uses.length ? uses.join(" · ") : "not used yet";
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

// The buttons at the end of each row: "Move to income" (or expense) and "Delete"
function createCategoryActions(category) {
  const actions = createElement("span", "category-actions");
  actions.append(createMoveCategoryButton(category), createDeleteCategoryButton(category));
  return actions;
}

// Moves the category to the other list. The server refuses (and the red line says why) while
// incomes or expenses of the current kind still use it.
function createMoveCategoryButton(category) {
  const otherKind = category.kind === "expense" ? "income" : "expense";
  const moveButton = createElement("button", "ghost", `→ ${otherKind}`);
  moveButton.type = "button";
  moveButton.title = `Move "${category.name}" to the ${otherKind} categories`;
  moveButton.onclick = () =>
    runThenReloadAllData(() => callApi(`/categories/${category.id}/kind`, { method: "PUT", body: { kind: otherKind } }));
  return moveButton;
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

// The "Add" form above each list; its data-kind says which list it adds to
export function initializeCategoriesPage() {
  for (const form of document.querySelectorAll(".category-add-form")) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = form.elements.name.value;
      runThenReloadAllData(async () => {
        await callApi("/categories", { method: "POST", body: { name, kind: form.dataset.kind } });
        form.reset();
      });
    });
  }
}
