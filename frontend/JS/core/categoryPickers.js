// ---- the category dropdowns (transaction and recurring forms, transactions filter) ----
// Option values are category ids, never names: a renamed category stays selected, and an income
// "Gift" and an expense "Gift" are two different choices.

import { elementById } from "./domHelpers.js";
import { appState } from "./appState.js";

export const UNCATEGORIZED_FILTER_VALUE = "__none"; // the "Uncategorized" choice of the filter

const KIND_LABELS = { expense: "Expense", income: "Income" };

// The kind of category a transaction type uses: income and expense have their own, anything else
// (movements, reconciliations) may use either, so null = both kinds
export const getCategoryKindForType = (transactionType) =>
  transactionType === "income" || transactionType === "expense" ? transactionType : null;

const createCategoryOption = (category) => new Option(category.name, category.id);

// The categories of one kind as options, or of both kinds in two labelled groups
function createCategoryOptions(kind) {
  if (kind) return appState.categories.filter((category) => category.kind === kind).map(createCategoryOption);
  return ["expense", "income"].map((groupKind) => {
    const group = document.createElement("optgroup");
    group.label = KIND_LABELS[groupKind];
    group.append(...appState.categories.filter((category) => category.kind === groupKind).map(createCategoryOption));
    return group;
  });
}

// Fills a form's category dropdown for a transaction type. The chosen category is kept if it still fits,
// otherwise the dropdown goes back to "no category" (switching an expense to income clears "Rent").
export function fillCategoryPicker(selectElement, transactionType) {
  const pickedCategoryId = selectElement.value;
  selectElement.replaceChildren(new Option("— no category —", ""), ...createCategoryOptions(getCategoryKindForType(transactionType)));
  selectElement.value = pickedCategoryId;
  if (selectElement.value !== pickedCategoryId) selectElement.value = "";
}

// The Transactions page filter: every category, grouped by kind, plus "Uncategorized"
export function fillCategoryFilter() {
  const categoryFilter = elementById("f-category"), filteredCategoryId = categoryFilter.value;
  categoryFilter.replaceChildren(new Option("All categories", ""), ...createCategoryOptions(null),
    new Option("Uncategorized", UNCATEGORIZED_FILTER_VALUE));
  categoryFilter.value = filteredCategoryId;
  if (categoryFilter.value !== filteredCategoryId) categoryFilter.value = ""; // the category was deleted
}
