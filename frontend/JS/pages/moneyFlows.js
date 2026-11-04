// ---- Statements > Money flows: the period's income and expenses as a Sankey diagram ----
// Where the money came from (income by category, investments sold, savings used) on the left, where it went
// (expenses by category, into investments, left as savings) on the right. The boxes come from the server
// (backend/server/services/sankeyFlows.js), already adding up to the income statement; this only draws them.
// Hovering or tapping a band writes its detail under the chart (phones have no hover).

import { elementById } from "../core/domHelpers.js";
import { euroFormatter, wholeEuroFormatter } from "../core/formatting.js";
import { drawSankeyChart } from "../charts/sankeyChart.js";
import { t, translateServerMessage } from "../core/i18n.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });
const DEFAULT_READOUT = t("Hover or tap a band to see its amount.");

let moneyFlows = null;

// "Groceries: 315,43 € · 18% of the money that came in" (+ what an "Other" box is made of)
function describeBox(box, side) {
  const shareText = moneyFlows.total ? percentFormatter.format(box.amount / moneyFlows.total) : "";
  const share = !moneyFlows.total ? "" : " · " + (side === "source" ? t("{share} of where the money came from", { share: shareText }) : t("{share} of where it went", { share: shareText }));
  const grouped = box.grouped ? ` (${box.grouped.map((item) => `${item.name} ${euroFormatter.format(item.amount)}`).join(", ")})` : "";
  return `${box.label}: ${euroFormatter.format(box.amount)}${share}${grouped}`;
}

function drawMoneyFlows() {
  const chartBox = elementById("st-flows-chart");
  drawSankeyChart(chartBox, { ...moneyFlows, middleLabel: t("Money in the period") }, {
    formatAmount: (amount) => wholeEuroFormatter.format(amount),
    onPick: (box, side) => { elementById("st-flows-readout").textContent = describeBox(box, side); },
  });
}

// The server names its own boxes in English ("Into investments", "Other income (3 categories)"); categories keep their names
const translateBoxes = (boxes) => boxes.map((box) => (box.category_id == null ? { ...box, label: translateServerMessage(box.label) } : box));

export function renderMoneyFlows(flows) {
  moneyFlows = { ...flows, sources: translateBoxes(flows.sources ?? []), uses: translateBoxes(flows.uses ?? []) };
  const isEmpty = !(flows.total > 0);
  elementById("st-flows-empty").hidden = !isEmpty;
  elementById("st-flows-box").hidden = isEmpty;
  elementById("st-flows-readout").textContent = DEFAULT_READOUT;
  const savingsText = flows.savings > 0 ? t("{amount} left as savings", { amount: euroFormatter.format(flows.savings) })
    : flows.savings < 0 ? t("{amount} taken from savings", { amount: euroFormatter.format(-flows.savings) }) : t("nothing saved or taken from savings");
  const investmentsText = flows.into_investments > 0 ? ` · ${t("{amount} into investments", { amount: euroFormatter.format(flows.into_investments) })}`
    : flows.into_investments < 0 ? ` · ${t("{amount} from investments sold", { amount: euroFormatter.format(-flows.into_investments) })}` : "";
  elementById("st-flows-summary").textContent = `${t("{amount} moved through the period", { amount: euroFormatter.format(flows.total) })} · ${savingsText}${investmentsText}`;
  if (!isEmpty) drawMoneyFlows();
}

// Drawn at the box's real width: again when the window changes size or the Statements page comes into view
export function initializeMoneyFlows() {
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => moneyFlows && moneyFlows.total > 0 && drawMoneyFlows(), 150);
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#statements" && moneyFlows?.total > 0) setTimeout(drawMoneyFlows); });
}
