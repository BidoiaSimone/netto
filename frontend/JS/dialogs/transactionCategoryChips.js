// ---- Pocket's category shortcuts in the transaction window ----
// Above the Category row, the categories you use most for this type, as round icons with their names under them:
// one tap picks one (a second tap on it takes it off again). Every other category is still in the Category row
// under them, one tap away. Shown for expenses and incomes only: movements and reconciliations rarely have one.
// The <select id="tx-category"> stays the only real field: a tap sets it and fires its "change", so saving, the
// description suggestions and everything else keep reading the select. Classic doesn't show the shortcuts
// (10-editable-rows-and-accounts.css).

import { elementById, createElement } from "../core/domHelpers.js";
import { getLocalDateDaysFromToday } from "../core/formatting.js";
import { appState } from "../core/appState.js";
import { createCategoryIcon } from "../core/categoryIcons.js";
import { getCategoryKindForType } from "../core/categoryPickers.js";

const NUMBER_OF_SHORTCUTS = 8;  // two rows of four on the phone
const RECENT_DAYS = 90;         // "most used" = in the last three months; older use only breaks ties

// The categories of a kind, most used lately first
function findMostUsedCategories(kind) {
  const since = getLocalDateDaysFromToday(-RECENT_DAYS);
  const recentUsesById = new Map();
  for (const transaction of appState.transactions) { // newest first
    if (transaction.date < since) break;
    if (transaction.category_id != null) recentUsesById.set(transaction.category_id, (recentUsesById.get(transaction.category_id) ?? 0) + 1);
  }
  const recentUses = (category) => recentUsesById.get(category.id) ?? 0;
  return appState.categories
    .filter((category) => category.kind === kind)
    .sort((first, second) => recentUses(second) - recentUses(first) || (second.used ?? 0) - (first.used ?? 0) || first.name.localeCompare(second.name))
    .slice(0, NUMBER_OF_SHORTCUTS);
}

// Draws the shortcuts for the type the window is on (called whenever the type or the category list changes)
export function renderTransactionCategoryChips() {
  const categoryPicker = elementById("tx-category"), chips = elementById("tx-category-chips");
  const kind = getCategoryKindForType(elementById("tx-type").value);
  const categories = kind && !categoryPicker.disabled ? findMostUsedCategories(kind) : [];
  chips.hidden = categories.length === 0;
  chips.replaceChildren(...categories.map((category) => {
    const chip = createElement("button", "category-chip");
    chip.type = "button";
    chip.dataset.categoryId = category.id;
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-label", category.name);
    chip.append(createCategoryIcon(category, "category-icon"), createElement("span", "category-chip-name", category.name));
    return chip;
  }));
  showPickedCategoryChip();
}

// Lights the shortcut of the category picked in the select, if it has one (call it after setting the select by code)
export function showPickedCategoryChip() {
  const pickedId = elementById("tx-category").value;
  for (const chip of elementById("tx-category-chips").children) chip.setAttribute("aria-checked", String(chip.dataset.categoryId === pickedId));
}

export function initializeTransactionCategoryChips() {
  const categoryPicker = elementById("tx-category"), chips = elementById("tx-category-chips");
  // a tap mustn't take the focus from the amount: the keyboard stays up while you pick (like the − and + buttons)
  chips.addEventListener("pointerdown", (event) => { if (event.target.closest(".category-chip")) event.preventDefault(); });
  chips.addEventListener("click", (event) => {
    const chip = event.target.closest(".category-chip");
    if (!chip || categoryPicker.disabled) return;
    categoryPicker.value = categoryPicker.value === chip.dataset.categoryId ? "" : chip.dataset.categoryId;
    categoryPicker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  categoryPicker.addEventListener("change", showPickedCategoryChip);
}
