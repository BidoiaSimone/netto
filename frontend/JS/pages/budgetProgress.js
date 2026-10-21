// ---- Insights > This month > Budgets: one bar per budgeted category (GET /budgets/this-month) ----
// Each bar shows the spending so far (solid) and the month-end projection (lighter, behind it), both as a share of
// the limit. Colour: normal, amber from 80% of the limit, red above it. The projection is worked out on the server
// (services/budgetCalculator.js) the same way as the "Projected spending" card: recurring expenses by their dates,
// the rest at this month's daily pace.

import { elementById, createElement } from "../core/domHelpers.js";
import { euroFormatter } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { createCategoryLabel } from "../core/categoryIcons.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const widthPercent = (share) => `${Math.min(Math.max(share, 0), 1) * 100}%`;

let lastProgress = null; // kept to draw again with the icons, when the categories arrive after it

export async function loadBudgetProgress() {
  lastProgress = await callApi("/budgets/this-month");
  renderBudgetProgress(lastProgress);
}

export function redrawBudgetProgress() {
  if (lastProgress) renderBudgetProgress(lastProgress);
}

// The line under each bar: what's left, or by how much it's over (or heading over)
function describeBudgetOutlook(category, isEarlyInTheMonth) {
  if (category.status === "over") return { text: `${euroFormatter.format(-category.left)} over`, className: "neg" };
  const left = `${euroFormatter.format(category.left)} left`;
  if (category.projected_over_by > 0) {
    const rough = isEarlyInTheMonth ? " (early in the month: rough)" : "";
    return { text: `${left} · on track to exceed by ${euroFormatter.format(category.projected_over_by)}${rough}`, className: "warn" };
  }
  return { text: `${left} · on track (≈ ${euroFormatter.format(category.projected)} by the end of the month)`, className: "" };
}

function createBudgetRow(category, isEarlyInTheMonth) {
  const row = createElement("div", `budget-row ${category.status}`);
  const head = createElement("div", "budget-row-head");
  head.append(
    createCategoryLabel(category.category_id, category.name),
    createElement("span", "budget-amounts", `${euroFormatter.format(category.spent)} of ${euroFormatter.format(category.limit)} · ${percentFormatter.format(category.share_used)}`),
  );
  const track = createElement("div", "budget-track");
  const projectedFill = createElement("span", "budget-projected");
  projectedFill.style.width = widthPercent(category.projected / category.limit);
  const spentFill = createElement("span", "budget-spent");
  spentFill.style.width = widthPercent(category.share_used);
  track.append(projectedFill, spentFill);
  track.title = `Spent ${euroFormatter.format(category.spent)}, heading for ${euroFormatter.format(category.projected)} of ${euroFormatter.format(category.limit)}`;
  const outlook = describeBudgetOutlook(category, isEarlyInTheMonth);
  row.append(head, track, createElement("small", `budget-outlook ${outlook.className}`, outlook.text));
  return row;
}

function renderBudgetProgress(progress) {
  const hasBudgets = progress.categories.length > 0;
  elementById("budget-empty").hidden = hasBudgets;
  // fullest first: what needs attention is on top
  const categoriesInOrder = [...progress.categories].sort((first, second) => second.share_used - first.share_used);
  elementById("budget-rows").replaceChildren(...categoriesInOrder.map((category) => createBudgetRow(category, progress.is_early_in_the_month)));
  elementById("budget-summary").textContent = hasBudgets
    ? `${euroFormatter.format(progress.total_spent)} of ${euroFormatter.format(progress.total_limit)} budgeted · day ${progress.day_of_month} of ${progress.days_in_month}`
    : "";
  elementById("budget-unbudgeted").textContent = progress.unbudgeted_spent > 0 || hasBudgets
    ? `Everything else (no budget): ${euroFormatter.format(progress.unbudgeted_spent)} spent this month`
    : "";
}
