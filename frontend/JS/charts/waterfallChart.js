// ---- waterfall chart (SVG): a starting total, the steps that change it, the final total ----
// Each step is a bar floating from where the previous one ended: up (green) adds, down (red) takes
// away. The first and last bars stand on zero. Used by the Statements page's net worth bridge.

import { createSvgElement } from "./svgHelpers.js";
import { formatSignedWholeEuros, wholeEuroFormatter } from "../core/formatting.js";

const CHART_WIDTH = 820, CHART_HEIGHT = 300;
const MARGIN = { top: 28, right: 8, bottom: 46, left: 8 };
const BAR_GAP_SHARE = 0.32; // part of each slot left empty between bars

// bars: [{ label, amount, isTotal }] — a total bar's amount is its height from zero, a step's is its change
export function drawWaterfallChart(container, bars, ariaLabel) {
  // where each bar starts and ends
  let runningTotal = 0;
  const placedBars = bars.map((bar) => {
    const start = bar.isTotal ? 0 : runningTotal;
    const end = bar.isTotal ? bar.amount : runningTotal + bar.amount;
    runningTotal = end;
    return { ...bar, start, end };
  });

  const lowest = Math.min(0, ...placedBars.flatMap((bar) => [bar.start, bar.end]));
  const highest = Math.max(0, ...placedBars.flatMap((bar) => [bar.start, bar.end]));
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const toY = (value) => MARGIN.top + (highest === lowest ? plotHeight : ((highest - value) / (highest - lowest)) * plotHeight);
  const slotWidth = (CHART_WIDTH - MARGIN.left - MARGIN.right) / placedBars.length;
  const barWidth = slotWidth * (1 - BAR_GAP_SHARE);

  const svg = createSvgElement("svg", { viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, role: "img", "aria-label": ariaLabel, class: "waterfall" });
  svg.append(createSvgElement("line", { x1: 0, x2: CHART_WIDTH, y1: toY(0), y2: toY(0), class: "waterfall-zero" }));

  placedBars.forEach((bar, index) => {
    const x = MARGIN.left + index * slotWidth + (slotWidth - barWidth) / 2;
    const top = toY(Math.max(bar.start, bar.end));
    const height = Math.max(1, Math.abs(toY(bar.start) - toY(bar.end))); // a 0 € step still shows as a line
    const direction = bar.isTotal ? "total" : bar.amount >= 0 ? "up" : "down";

    const rect = createSvgElement("rect", { x, y: top, width: barWidth, height, rx: 3, class: `waterfall-bar ${direction}` });
    const tooltip = createSvgElement("title", {});
    tooltip.textContent = `${bar.label}: ${bar.isTotal ? wholeEuroFormatter.format(bar.amount) : formatSignedWholeEuros(bar.amount)}`;
    rect.append(tooltip);

    // dashed line from this bar's end to the next bar
    if (index < placedBars.length - 1) {
      svg.append(createSvgElement("line", {
        x1: x + barWidth, x2: x + slotWidth, y1: toY(bar.end), y2: toY(bar.end), class: "waterfall-connector",
      }));
    }

    const value = createSvgElement("text", { x: x + barWidth / 2, y: top - 8, class: `waterfall-value ${direction}` });
    value.textContent = bar.isTotal ? wholeEuroFormatter.format(bar.amount) : formatSignedWholeEuros(bar.amount);
    const label = createSvgElement("text", { x: x + barWidth / 2, y: CHART_HEIGHT - MARGIN.bottom + 20, class: "waterfall-label" });
    label.textContent = bar.label;
    svg.append(rect, value, label);
  });

  container.replaceChildren(svg);
}
