// ---- Insights > Category trends (GET /insights/category-trends) ----
// Each expense category this month (so far, and where it's heading) against your usual: the average of the
// complete months before it. Categories heading clearly above it are highlighted and listed first.
// The maths, and what "clearly" and "a trip" mean, are in backend/server/services/categoryTrends.js.

import { elementById, createElement, fillTableBody } from "../core/domHelpers.js";
import { euroFormatter, formatSignedEuros } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { saveAppSetting } from "../core/appSettings.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { createSparkline } from "../charts/sparkline.js";
import { createCategoryLabel } from "../core/categoryIcons.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const monthNameFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
const formatMonthName = (yearMonth) => monthNameFormatter.format(new Date(yearMonth + "-15T12:00"));

let trends = null;

export async function loadCategoryTrends() {
  trends = await callApi("/insights/category-trends");
  renderCategoryTrends();
}

// "+179% · +89,50 €"; "new · +39,90 €" when the usual is 0; "—" without a usual average, or with nothing either side
function createComparisonCell(category) {
  if (category.average === null || (category.average === 0 && category.projected === 0)) return createElement("span", "muted", "—");
  const shareText = category.difference_share === null ? "new" : `${category.difference_share > 0 ? "+" : category.difference_share < 0 ? "−" : ""}${percentFormatter.format(Math.abs(category.difference_share))}`;
  return createElement("span", category.is_running_hot ? "trend-hot" : "trend-normal", `${shareText} · ${formatSignedEuros(category.difference)}`);
}

function createNameCell(category) {
  const cell = createElement("span", "trend-name");
  cell.append(createCategoryLabel(category.category_id, category.name));
  if (category.is_running_hot) cell.append(createElement("span", "status-pill warn trend-pill", "running hot"));
  return cell;
}

function createSparklineCell(category) {
  const totals = category.sparkline.map((point) => point.total);
  const label = category.sparkline.map((point) => `${formatMonthName(point.month)} ${euroFormatter.format(point.total)}`).join(", ");
  return createSparkline(totals, {
    referenceValue: category.average,
    lastPointIsPartial: true,
    colorClass: category.is_running_hot ? "hot" : "",
    label: `Last 12 months: ${label}`,
  });
}

// "Usual = the average of Apr–Sep (6 months), trips left out (646,60 €)."
export function renderCategoryTrends() {
  if (!trends) return;
  const categories = trends.categories;
  elementById("trends-empty").hidden = categories.length > 0;
  elementById("trends-table-box").hidden = categories.length === 0;
  fillTableBody("trends-body", categories, (category) => [
    createNameCell(category),
    euroFormatter.format(category.this_month),
    euroFormatter.format(category.projected),
    euroFormatter.format(category.last_month),
    category.average === null ? "—" : euroFormatter.format(category.average),
    createComparisonCell(category),
    createSparklineCell(category),
  ]);
  [...elementById("trends-body").rows].forEach((tableRow, index) => tableRow.classList.toggle("running-hot", categories[index].is_running_hot));
  const hotCount = categories.filter((category) => category.is_running_hot).length;
  elementById("trends-summary").textContent = hotCount
    ? `${hotCount} ${hotCount === 1 ? "category is" : "categories are"} running above usual this month.`
    : "Every category is within its usual range this month.";
  elementById("trends-exclude-trips").checked = trends.excluding_trips;
}

export function initializeCategoryTrends() {
  elementById("trends-exclude-trips").addEventListener("change", async (event) => {
    try {
      await saveAppSetting("trend_exclude_trips", event.target.checked ? 1 : 0);
      await loadCategoryTrends();
    } catch (error) {
      showErrorMessage(error.message);
    }
  });
}

// Settings page: the thresholds changed, so the highlights change too
export const reloadCategoryTrends = () => loadCategoryTrends().catch((error) => showErrorMessage(error.message));
