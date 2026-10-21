// ---- a sparkline: a tiny line of a few values, no axes (drawing only, no app data) ----
// Used by Insights > Category trends for each category's last 12 months. An optional reference value is drawn
// as a dashed line (the usual average), and the last point as a hollow dot when it isn't complete yet
// (this month so far).

import { createSvgElement } from "./svgHelpers.js";

const WIDTH = 120, HEIGHT = 30, PADDING = 3;

// values: numbers, oldest first. Returns an <svg> to put in a table cell.
export function createSparkline(values, { referenceValue = null, lastPointIsPartial = false, colorClass = "", label = "" } = {}) {
  const svg = createSvgElement("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, width: WIDTH, height: HEIGHT, class: `sparkline ${colorClass}`, role: "img", "aria-label": label });
  if (!values.length) return svg;
  const highest = Math.max(...values, referenceValue ?? 0) || 1;
  const xOf = (index) => PADDING + (values.length === 1 ? 0 : (index / (values.length - 1)) * (WIDTH - 2 * PADDING));
  const yOf = (value) => HEIGHT - PADDING - (value / highest) * (HEIGHT - 2 * PADDING);

  if (referenceValue !== null) {
    svg.append(createSvgElement("line", { x1: PADDING, x2: WIDTH - PADDING, y1: yOf(referenceValue), y2: yOf(referenceValue), class: "sparkline-reference" }));
  }
  svg.append(createSvgElement("polyline", { points: values.map((value, index) => `${xOf(index)},${yOf(value)}`).join(" "), class: "sparkline-line" }));
  const lastIndex = values.length - 1;
  svg.append(createSvgElement("circle", { cx: xOf(lastIndex), cy: yOf(values[lastIndex]), r: 2.6, class: lastPointIsPartial ? "sparkline-dot partial" : "sparkline-dot" }));
  if (label) svg.append(Object.assign(createSvgElement("title", {}), { textContent: label }));
  return svg;
}
