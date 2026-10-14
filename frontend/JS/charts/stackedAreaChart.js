// ---- stacked area chart (SVG): parts stacked on top of each other, their total as the top line ----
// Used for net worth over time: accounts at the bottom, investments on top, net worth = the top edge.
// The value axis always includes 0, because an area's height is read as an amount.

import { createElement } from "../core/domHelpers.js";
import { euroFormatter, formatShortDate } from "../core/formatting.js";
import { createSvgElement } from "./svgHelpers.js";
import { chooseValueAxis, drawValueGrid, drawDateLabels, placeTooltipNearPoint, findNearestIndex } from "./chartAxis.js";

const CHART_MARGINS = { top: 12, right: 16, bottom: 24, left: 72 };

// layers: [{ name, values, className }] bottom first, one value per date.
// totalName: what the sum is called in the tooltip ("Net worth").
export function drawStackedAreaChart(container, dates, layers, totalName) {
  const width = container.clientWidth || 600, height = container.clientHeight || 260;
  const margins = CHART_MARGINS;
  const lastIndex = dates.length - 1;

  // the running sum below and above each layer, per date
  const layerEdges = [];
  let edgeBelow = dates.map(() => 0);
  for (const layer of layers) {
    const edgeAbove = edgeBelow.map((value, index) => value + layer.values[index]);
    layerEdges.push({ layer, edgeBelow, edgeAbove });
    edgeBelow = edgeAbove;
  }
  const totals = edgeBelow;

  const allEdgeValues = layerEdges.flatMap(({ edgeBelow: below, edgeAbove: above }) => [...below, ...above]);
  const valueAxis = chooseValueAxis(Math.min(0, ...allEdgeValues), Math.max(0, ...allEdgeValues));
  const { axisBottom, axisTop } = valueAxis;
  const xOfIndex = (index) => margins.left + (lastIndex ? index / lastIndex : 0.5) * (width - margins.left - margins.right);
  const yOfValue = (value) => margins.top + (1 - (value - axisBottom) / (axisTop - axisBottom)) * (height - margins.top - margins.bottom);
  const pointsOf = (edgeValues) => edgeValues.map((value, index) => `${xOfIndex(index).toFixed(1)},${yOfValue(value).toFixed(1)}`);

  const svg = createSvgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${totalName} over time` });
  drawValueGrid(svg, valueAxis, { margins, width, yOfValue });
  drawDateLabels(svg, dates, { height, xOfIndex });

  for (const { layer, edgeBelow: below, edgeAbove: above } of layerEdges) {
    const abovePoints = pointsOf(above), belowPoints = pointsOf(below).reverse();
    svg.append(createSvgElement("path", { class: `layer ${layer.className}`, d: `M${abovePoints.join("L")}L${belowPoints.join("L")}Z` }));
    svg.append(createSvgElement("path", { class: `layer-edge ${layer.className}`, d: `M${abovePoints.join("L")}` }));
  }
  svg.append(createSvgElement("path", { class: "total-line", d: `M${pointsOf(totals).join("L")}` }));

  const tooltip = addHoverCrosshair({ svg, dates, layers, totals, totalName, width, height, margins, xOfIndex, yOfValue });
  container.replaceChildren(svg, tooltip);
}

// Moving the pointer over the chart shows that day's total and each part. Returns the tooltip element.
function addHoverCrosshair({ svg, dates, layers, totals, totalName, width, height, margins, xOfIndex, yOfValue }) {
  const crosshairLine = createSvgElement("line", { class: "cross", y1: margins.top, y2: height - margins.bottom, visibility: "hidden" });
  const hoverDot = createSvgElement("circle", { class: "hover-dot", r: 5, visibility: "hidden" });
  const pointerArea = createSvgElement("rect", { x: margins.left, y: 0, width: width - margins.left - margins.right, height, fill: "transparent" });
  svg.append(crosshairLine, hoverDot, pointerArea);
  const tooltip = createElement("div", "tip");
  tooltip.hidden = true;

  const showPointNearest = (pointerClientX) => {
    const nearestIndex = findNearestIndex(svg, pointerClientX, { width, margins, numberOfPoints: dates.length });
    const pointX = xOfIndex(nearestIndex), pointY = yOfValue(totals[nearestIndex]);
    for (const marker of [crosshairLine, hoverDot]) marker.setAttribute("visibility", "visible");
    crosshairLine.setAttribute("x1", pointX); crosshairLine.setAttribute("x2", pointX);
    hoverDot.setAttribute("cx", pointX); hoverDot.setAttribute("cy", pointY);

    // top layer first, like the chart reads from top to bottom
    const layerRows = [...layers].reverse().map((layer) => {
      const row = createElement("span", "tip-row");
      row.append(createElement("i", `swatch ${layer.className}`), `${layer.name} ${euroFormatter.format(layer.values[nearestIndex])}`);
      return row;
    });
    tooltip.replaceChildren(document.createTextNode(`${totalName} · ${formatShortDate(dates[nearestIndex], true)}`),
      createElement("strong", "", euroFormatter.format(totals[nearestIndex])), ...layerRows);
    tooltip.hidden = false;
    placeTooltipNearPoint(tooltip, svg, { pointX, pointY, width, height });
  };
  const hideHover = () => {
    tooltip.hidden = true;
    for (const marker of [crosshairLine, hoverDot]) marker.setAttribute("visibility", "hidden");
  };
  pointerArea.addEventListener("pointermove", (event) => showPointNearest(event.clientX));
  pointerArea.addEventListener("pointerdown", (event) => showPointNearest(event.clientX));
  pointerArea.addEventListener("pointerleave", hideHover);
  return tooltip;
}
