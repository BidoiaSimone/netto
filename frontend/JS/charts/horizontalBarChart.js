// ---- horizontal bar chart (HTML, styled in investmentsCharts.css): name | track | value label ----
// Bars grow right from a zero line (left for negatives); the zero line sits where the data needs it,
// so an all-positive chart uses the full width.

import { elementById, createElement } from "../core/domHelpers.js";

// bars: [{ name, value, label, colorClass? }]. colorClass defaults to "pos" / "neg" by sign.
export function drawHorizontalBarChart(containerId, bars, { sortBiggestFirst = true } = {}) {
  const container = elementById(containerId);
  if (!bars.length) return container.replaceChildren(createElement("p", "chart-empty", "No data yet"));

  const largestPositive = Math.max(0, ...bars.map((bar) => bar.value));
  const largestNegative = Math.max(0, ...bars.map((bar) => -bar.value));
  const fullSpan = largestPositive + largestNegative || 1;
  const zeroLinePercent = (largestNegative / fullSpan) * 100;
  const barsInOrder = sortBiggestFirst ? [...bars].sort((first, second) => second.value - first.value) : bars;

  container.replaceChildren(...barsInOrder.map((bar) => {
    const barRow = createElement("div", "hbar");
    const track = createElement("div", "track");
    if (largestNegative > 0) {
      const zeroLine = createElement("span", "zero");
      zeroLine.style.left = zeroLinePercent + "%";
      track.append(zeroLine);
    }
    const barFill = createElement("span", "fill " + (bar.colorClass ?? (bar.value >= 0 ? "pos" : "neg")));
    const widthPercent = (Math.abs(bar.value) / fullSpan) * 100;
    barFill.style.left = (bar.value >= 0 ? zeroLinePercent : zeroLinePercent - widthPercent) + "%";
    barFill.style.width = widthPercent + "%";
    track.append(barFill);
    const cells = [createElement("span", "name", bar.name), track, createElement("span", "val", bar.label)];
    cells.forEach((cell) => (cell.title = `${bar.name}: ${bar.label}`));
    barRow.append(...cells);
    return barRow;
  }));
}
