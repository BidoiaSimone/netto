// ---- value axis and date labels shared by the SVG charts ----

import { formatShortDate } from "../core/formatting.js";
import { createSvgElement } from "./svgHelpers.js";

// Round axis steps (1, 2, 2.5 or 5 × 10^n) so the labels read 8.500 €, 9.000 € ...
// Returns the axis bottom and top (multiples of the step), the step, and a formatter for its labels.
export function chooseValueAxis(lowestValue, highestValue) {
  const roughStep = (highestValue - lowestValue || Math.abs(highestValue) * 0.1 || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= roughStep);
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const axisBottom = Math.floor(lowestValue / step) * step;
  // every value the same (e.g. all 0 on an empty database): bottom and top would be equal and the charts would
  // divide by zero when placing points (NaN everywhere), so the axis gets a height of its own
  const axisTop = Math.max(Math.ceil(highestValue / step) * step, axisBottom + 4 * step);
  return {
    axisBottom,
    axisTop,
    step,
    labelFormatter: new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  };
}

// Horizontal grid lines with their value labels on the left
export function drawValueGrid(svg, { axisBottom, axisTop, step, labelFormatter }, { margins, width, yOfValue }) {
  for (let value = axisBottom; value <= axisTop + step / 2; value += step) {
    svg.append(createSvgElement("line", { class: "grid", x1: margins.left, x2: width - margins.right, y1: yOfValue(value), y2: yOfValue(value) }));
    const valueLabel = createSvgElement("text", { class: "axis", x: margins.left - 8, y: yOfValue(value) + 4, "text-anchor": "end" });
    valueLabel.textContent = labelFormatter.format(value);
    svg.append(valueLabel);
  }
}

// Date labels under the plot: first, middle and last date (with the year when the dates span two years)
export function drawDateLabels(svg, dates, { height, xOfIndex }) {
  const spansMoreThanOneYear = dates[0].slice(0, 4) !== dates[dates.length - 1].slice(0, 4);
  [[0, "start"], [Math.floor((dates.length - 1) / 2), "middle"], [dates.length - 1, "end"]].forEach(([index, textAnchor]) => {
    const dateLabel = createSvgElement("text", { class: "axis", x: xOfIndex(index), y: height - 6, "text-anchor": textAnchor });
    dateLabel.textContent = formatShortDate(dates[index], spansMoreThanOneYear);
    svg.append(dateLabel);
  });
}

// Places a tooltip next to a point (pointX, pointY in viewBox units), flipping to the left near the right edge
export function placeTooltipNearPoint(tooltip, svg, { pointX, pointY, width, height }) {
  const svgRectangle = svg.getBoundingClientRect();
  const tooltipX = (pointX / width) * svgRectangle.width;
  tooltip.style.left = Math.min(tooltipX + 12, svgRectangle.width - tooltip.offsetWidth) + "px";
  if (tooltipX + 12 + tooltip.offsetWidth > svgRectangle.width) tooltip.style.left = Math.max(0, tooltipX - tooltip.offsetWidth - 12) + "px";
  tooltip.style.top = Math.max(0, (pointY / height) * svgRectangle.height - tooltip.offsetHeight - 10) + "px";
}

// Which data point is nearest to the pointer, horizontally
export function findNearestIndex(svg, pointerClientX, { width, margins, numberOfPoints }) {
  const svgRectangle = svg.getBoundingClientRect();
  const pointerX = ((pointerClientX - svgRectangle.left) / svgRectangle.width) * width;
  const plotWidth = width - margins.left - margins.right;
  return Math.max(0, Math.min(numberOfPoints - 1, Math.round(((pointerX - margins.left) / plotWidth) * (numberOfPoints - 1))));
}
