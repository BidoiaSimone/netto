// ---- line chart (SVG): one series, a dashed reference line (e.g. your average price) and a hover crosshair ----

import { createElement } from "../core/domHelpers.js";
import { euroFormatter, formatShortDate, formatSignedPercent } from "../core/formatting.js";
import { createSvgElement } from "./svgHelpers.js";
import { chooseValueAxis, drawValueGrid, drawDateLabels, placeTooltipNearPoint, findNearestIndex } from "./chartAxis.js";

const CHART_MARGINS = { top: 12, right: 16, bottom: 24, left: 64 };

// dates: ["YYYY-MM-DD", ...], values: one number per date, referenceValue: where the dashed line goes
export function drawLineChart(container, dates, values, referenceValue, referenceName) {
  const width = container.clientWidth || 600, height = container.clientHeight || 260;
  const margins = CHART_MARGINS;
  const valueAxis = chooseValueAxis(Math.min(...values, referenceValue), Math.max(...values, referenceValue));
  const { axisBottom, axisTop } = valueAxis;
  const xOfIndex = (index) => margins.left + (index / (values.length - 1)) * (width - margins.left - margins.right);
  const yOfValue = (value) => margins.top + (1 - (value - axisBottom) / (axisTop - axisBottom)) * (height - margins.top - margins.bottom);

  const svg = createSvgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Price over time" });
  svg.innerHTML = `<defs><linearGradient id="inv-fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" style="stop-color: var(--accent)" stop-opacity="0.22"/><stop offset="1" style="stop-color: var(--accent)" stop-opacity="0"/></linearGradient></defs>`;

  drawValueGrid(svg, valueAxis, { margins, width, yOfValue });
  drawDateLabels(svg, dates, { height, xOfIndex });

  const linePoints = values.map((value, index) => `${xOfIndex(index).toFixed(1)},${yOfValue(value).toFixed(1)}`);
  const lastIndex = values.length - 1;
  svg.append(createSvgElement("path", { class: "area", d: `M${linePoints.join("L")}L${xOfIndex(lastIndex)},${height - margins.bottom}L${margins.left},${height - margins.bottom}Z` }));
  svg.append(createSvgElement("line", { class: "ref", x1: margins.left, x2: width - margins.right, y1: yOfValue(referenceValue), y2: yOfValue(referenceValue) }));
  svg.append(createReferenceLabel({ values, referenceValue, referenceName, width, height, margins, yOfValue }));
  svg.append(createSvgElement("path", { class: "line", d: `M${linePoints.join("L")}` }));

  const tooltip = addHoverCrosshair({ svg, dates, values, referenceValue, referenceName, width, height, margins, xOfIndex, yOfValue });
  container.replaceChildren(svg, tooltip);
}

// Label at the right end, on the side of the dashed line the data is NOT on at the end
// (and always inside the plot, so it never sits on the date labels)
function createReferenceLabel({ values, referenceValue, referenceName, width, height, margins, yOfValue }) {
  let isBelowLine = values[values.length - 1] >= referenceValue;
  if (isBelowLine && yOfValue(referenceValue) + 15 > height - margins.bottom - 2) isBelowLine = false;
  if (!isBelowLine && yOfValue(referenceValue) - 7 < margins.top + 10) isBelowLine = true;
  const referenceLabel = createSvgElement("text", {
    class: "ref-label", x: width - margins.right - 4, y: yOfValue(referenceValue) + (isBelowLine ? 15 : -7), "text-anchor": "end",
  });
  referenceLabel.textContent = `${referenceName} ${euroFormatter.format(referenceValue)}`;
  return referenceLabel;
}

// Moving the pointer over the chart shows the closest point's date and value. Returns the tooltip element.
function addHoverCrosshair({ svg, dates, values, referenceValue, referenceName, width, height, margins, xOfIndex, yOfValue }) {
  const crosshairLine = createSvgElement("line", { class: "cross", y1: margins.top, y2: height - margins.bottom, visibility: "hidden" });
  const hoverDot = createSvgElement("circle", { class: "hover-dot", r: 5, visibility: "hidden" });
  const pointerArea = createSvgElement("rect", { x: margins.left, y: 0, width: width - margins.left - margins.right, height, fill: "transparent" });
  svg.append(crosshairLine, hoverDot, pointerArea);
  const tooltip = createElement("div", "tip");
  tooltip.hidden = true;

  const showPointNearest = (pointerClientX) => {
    const nearestIndex = findNearestIndex(svg, pointerClientX, { width, margins, numberOfPoints: values.length });
    const pointX = xOfIndex(nearestIndex), pointY = yOfValue(values[nearestIndex]);
    for (const marker of [crosshairLine, hoverDot]) marker.setAttribute("visibility", "visible");
    crosshairLine.setAttribute("x1", pointX); crosshairLine.setAttribute("x2", pointX);
    hoverDot.setAttribute("cx", pointX); hoverDot.setAttribute("cy", pointY);

    const differenceFromReference = values[nearestIndex] - referenceValue;
    tooltip.replaceChildren(document.createTextNode(formatShortDate(dates[nearestIndex], true)), createElement("strong", "", euroFormatter.format(values[nearestIndex])),
      createElement("span", differenceFromReference >= 0 ? "pos" : "neg", `${formatSignedPercent((differenceFromReference / referenceValue) * 100)} vs ${referenceName.toLowerCase()}`));
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
