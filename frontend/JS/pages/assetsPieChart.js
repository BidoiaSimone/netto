// ---- Assets page: the pie showing how the accounts' money is split (SVG drawn here) ----
// One colour per account, picked by its position in the accounts list (= the order you created them),
// so an account keeps its colour when amounts change. Colours checked for colour-blind separation on the dark background.

import { elementById, createElement } from "../core/domHelpers.js";
import { euroFormatter, animateEuroAmount } from "../core/formatting.js";
import { appState, isAccountOpen } from "../core/appState.js";
import { createSvgElement } from "../charts/svgHelpers.js";

const SLICE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OTHER_SLICE_COLOR = "#5b6b62";
const PIE_CENTER = 100, PIE_RADIUS = 96; // in a 200×200 viewBox

// Positive balances only, biggest first, at most one slice per colour (the rest folded into "Other")
function buildSlices() {
  // the colour comes from the position among ALL accounts, so closing one doesn't recolour the others
  let slices = appState.accounts
    .map((account, index) => ({ accountId: account.id, name: account.name, value: account.balance, color: SLICE_COLORS[index], isOpen: isAccountOpen(account) }))
    .filter((slice) => slice.isOpen && slice.value > 0)
    .sort((first, second) => second.value - first.value);

  // More than 8 accounts: keep the 7 biggest and fold the rest into "Other" (never invent a 9th colour)
  if (slices.length > SLICE_COLORS.length) {
    const foldedSlices = slices.slice(SLICE_COLORS.length - 1);
    slices = slices.slice(0, SLICE_COLORS.length - 1);
    slices.push({
      name: `Other (${foldedSlices.length})`,
      value: foldedSlices.reduce((sum, slice) => sum + slice.value, 0),
      color: OTHER_SLICE_COLOR,
      memberAccountIds: foldedSlices.map((slice) => slice.accountId),
    });
  }
  // an account past the 8th has no colour of its own: give it one of the colours nobody is using
  const usedColors = new Set(slices.map((slice) => slice.color).filter(Boolean));
  const freeColors = SLICE_COLORS.filter((color) => !usedColors.has(color));
  slices.forEach((slice) => { if (!slice.color) slice.color = freeColors.shift(); });
  return slices;
}

const pointOnCircle = (angle) =>
  `${(PIE_CENTER + PIE_RADIUS * Math.cos(angle)).toFixed(2)},${(PIE_CENTER + PIE_RADIUS * Math.sin(angle)).toFixed(2)}`;

export function renderAssetsPieChart() {
  const totalOfAllAccounts = appState.accounts.reduce((sum, account) => sum + account.balance, 0); // closed accounts are at 0
  animateEuroAmount(elementById("assets-total"), totalOfAllAccounts);

  // A pie can only show positive parts; anything at zero or below is listed in a note instead
  const slices = buildSlices();
  const accountsLeftOut = appState.accounts.filter((account) => isAccountOpen(account) && account.balance <= 0);
  elementById("assets-pie-note").textContent = accountsLeftOut.length
    ? `Not in the chart (zero or negative): ${accountsLeftOut.map((account) => `${account.name} ${euroFormatter.format(account.balance)}`).join(", ")}`
    : "";

  const chartBox = elementById("assets-pie");
  if (!slices.length) {
    elementById("assets-legend").replaceChildren();
    return chartBox.replaceChildren(createElement("p", "chart-empty", "Add an account to see how your assets are split"));
  }

  const svg = createSvgElement("svg", { viewBox: "0 0 200 200", role: "img", "aria-label": "How your assets are split" });
  const tooltip = createElement("div", "tip");
  tooltip.hidden = true;
  const sliceMarks = drawSlicesWithLegendRows(svg, slices); // [{ slice, slicePath, legendRow }]
  addHoverHighlighting(sliceMarks, chartBox, tooltip);

  chartBox.replaceChildren(svg, tooltip);
  elementById("assets-legend").replaceChildren(...sliceMarks.map((mark) => mark.legendRow));
}

function drawSlicesWithLegendRows(svg, slices) {
  const totalShown = slices.reduce((sum, slice) => sum + slice.value, 0);
  const sliceMarks = [];
  let angle = -Math.PI / 2; // start at 12 o'clock, go clockwise
  for (const slice of slices) {
    const sweep = (slice.value / totalShown) * Math.PI * 2;
    const slicePath = slices.length === 1
      ? createSvgElement("circle", { cx: PIE_CENTER, cy: PIE_CENTER, r: PIE_RADIUS })
      : createSvgElement("path", { d: `M${PIE_CENTER},${PIE_CENTER}L${pointOnCircle(angle)}A${PIE_RADIUS},${PIE_RADIUS} 0 ${sweep > Math.PI ? 1 : 0} 1 ${pointOnCircle(angle + sweep)}Z` });
    slicePath.setAttribute("class", "slice");
    slicePath.setAttribute("fill", slice.color);
    slice.middleAngle = angle + sweep / 2;
    slice.percent = (slice.value / totalShown) * 100;
    angle += sweep;
    svg.append(slicePath);

    const legendRow = createElement("li");
    const colorSwatch = createElement("i", "swatch");
    colorSwatch.style.background = slice.color;
    legendRow.append(colorSwatch, createElement("span", "name", slice.name),
      createElement("span", "pct", slice.percent.toFixed(1) + "%"), createElement("span", "val", euroFormatter.format(slice.value)));
    sliceMarks.push({ slice, slicePath, legendRow });
  }
  return sliceMarks;
}

// Hover a slice or a legend row: that part lights up (and its row in the accounts list)
function addHoverHighlighting(sliceMarks, chartBox, tooltip) {
  const highlight = (highlightedMark) => {
    for (const mark of sliceMarks) {
      const isHighlighted = mark === highlightedMark;
      mark.slicePath.classList.toggle("dim", Boolean(highlightedMark) && !isHighlighted);
      mark.legendRow.classList.toggle("on", isHighlighted);
    }
    const highlightedAccountIds = highlightedMark ? (highlightedMark.slice.memberAccountIds ?? [highlightedMark.slice.accountId]) : [];
    for (const tableRow of elementById("assets-body").rows) tableRow.classList.toggle("hl", highlightedAccountIds.includes(Number(tableRow.dataset.accountId)));
    if (!highlightedMark) {
      tooltip.hidden = true;
      return;
    }
    const { slice } = highlightedMark;
    tooltip.replaceChildren(document.createTextNode(slice.name), createElement("strong", "", euroFormatter.format(slice.value)),
      document.createTextNode(`${slice.percent.toFixed(1)}% of the chart`));
    tooltip.hidden = false;
    // place the tooltip just outside the middle of the slice
    const boxRectangle = chartBox.getBoundingClientRect(), scale = boxRectangle.width / 200;
    const x = (PIE_CENTER + PIE_RADIUS * 0.6 * Math.cos(slice.middleAngle)) * scale;
    const y = (PIE_CENTER + PIE_RADIUS * 0.6 * Math.sin(slice.middleAngle)) * scale;
    tooltip.style.left = Math.max(0, Math.min(x - tooltip.offsetWidth / 2, boxRectangle.width - tooltip.offsetWidth)) + "px";
    tooltip.style.top = Math.max(0, y - tooltip.offsetHeight - 8) + "px";
  };
  for (const mark of sliceMarks) {
    for (const hoverTarget of [mark.slicePath, mark.legendRow]) {
      hoverTarget.addEventListener("pointerenter", () => highlight(mark));
      hoverTarget.addEventListener("pointerleave", () => highlight(null));
    }
  }
}
