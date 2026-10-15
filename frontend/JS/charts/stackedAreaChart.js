// ---- stacked area chart (SVG): parts stacked on top of each other, their total as the top line ----
// Used for net worth over time: accounts at the bottom, investments on top, net worth = the top edge.
// The value axis always includes 0, because an area's height is read as an amount.
//
// Two optional extras, used by the Forecast page (Insights draws the chart without them):
//   forecastFromIndex  from this point on the values are a forecast: a "today" line is drawn there and
//                      everything to its right is lighter with dashed edges (two copies of the areas, each
//                      clipped to its side of the line, so one path never has to change style halfway)
//   band               { low, high, label }: a shaded range around the total (null where there's none),
//                      e.g. the net worth at 0% and at 8% return

import { createElement } from "../core/domHelpers.js";
import { euroFormatter, formatShortDate } from "../core/formatting.js";
import { createSvgElement } from "./svgHelpers.js";
import { chooseValueAxis, drawValueGrid, drawDateLabels, placeTooltipNearPoint, findNearestIndex } from "./chartAxis.js";

const CHART_MARGINS = { top: 12, right: 16, bottom: 24, left: 72 };

// layers: [{ name, values, className }] bottom first, one value per date.
// totalName: what the sum is called in the tooltip ("Net worth").
// options: { forecastFromIndex, band } (see the top of the file), both optional.
export function drawStackedAreaChart(container, dates, layers, totalName, { forecastFromIndex = null, band = null } = {}) {
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

  const bandValues = band ? [...band.low, ...band.high].filter((value) => value !== null) : [];
  const allEdgeValues = [...layerEdges.flatMap(({ edgeBelow: below, edgeAbove: above }) => [...below, ...above]), ...bandValues];
  const valueAxis = chooseValueAxis(Math.min(0, ...allEdgeValues), Math.max(0, ...allEdgeValues));
  const { axisBottom, axisTop } = valueAxis;
  const xOfIndex = (index) => margins.left + (lastIndex ? index / lastIndex : 0.5) * (width - margins.left - margins.right);
  const yOfValue = (value) => margins.top + (1 - (value - axisBottom) / (axisTop - axisBottom)) * (height - margins.top - margins.bottom);
  const pointsOf = (edgeValues) => edgeValues.map((value, index) => `${xOfIndex(index).toFixed(1)},${yOfValue(value).toFixed(1)}`);

  const svg = createSvgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${totalName} over time` });
  drawValueGrid(svg, valueAxis, { margins, width, yOfValue });
  drawDateLabels(svg, dates, { height, xOfIndex });

  // the areas and the total line, in a group; drawn once, or twice (history | forecast) when there's a forecast
  const drawAreas = (group) => {
    for (const { layer, edgeBelow: below, edgeAbove: above } of layerEdges) {
      const abovePoints = pointsOf(above), belowPoints = pointsOf(below).reverse();
      group.append(createSvgElement("path", { class: `layer ${layer.className}`, d: `M${abovePoints.join("L")}L${belowPoints.join("L")}Z` }));
      group.append(createSvgElement("path", { class: `layer-edge ${layer.className}`, d: `M${abovePoints.join("L")}` }));
    }
    group.append(createSvgElement("path", { class: "total-line", d: `M${pointsOf(totals).join("L")}` }));
    return group;
  };
  if (band) drawBand(svg, band, pointsOf);
  if (forecastFromIndex === null) {
    drawAreas(svg);
  } else {
    const todayX = xOfIndex(forecastFromIndex);
    const clipId = `${container.id || "chart"}-clip`;
    const definitions = createSvgElement("defs", {});
    definitions.append(
      clipRectangle(`${clipId}-history`, 0, todayX, height),
      clipRectangle(`${clipId}-forecast`, todayX, width - todayX, height),
    );
    svg.append(definitions);
    svg.append(drawAreas(createSvgElement("g", { "clip-path": `url(#${clipId}-history)` })));
    svg.append(drawAreas(createSvgElement("g", { class: "forecast-part", "clip-path": `url(#${clipId}-forecast)` })));
    svg.append(createSvgElement("line", { class: "today-line", x1: todayX, x2: todayX, y1: margins.top, y2: height - margins.bottom }));
    const todayLabel = createSvgElement("text", { class: "today-label", x: todayX + 4, y: margins.top + 10 });
    todayLabel.textContent = "today";
    svg.append(todayLabel);
  }

  const tooltip = addHoverCrosshair({ svg, dates, layers, totals, totalName, width, height, margins, xOfIndex, yOfValue, forecastFromIndex, band });
  container.replaceChildren(svg, tooltip);
}

// A clipping rectangle: only what's inside it is drawn
function clipRectangle(id, x, rectangleWidth, height) {
  const clipPath = createSvgElement("clipPath", { id });
  clipPath.append(createSvgElement("rect", { x, y: 0, width: Math.max(0, rectangleWidth), height }));
  return clipPath;
}

// The shaded range between band.low and band.high, only where both exist, with dashed edges
function drawBand(svg, band, pointsOf) {
  const firstIndex = band.low.findIndex((value) => value !== null);
  if (firstIndex < 0) return;
  const lowPoints = pointsOf(band.low).slice(firstIndex), highPoints = pointsOf(band.high).slice(firstIndex);
  svg.append(createSvgElement("path", { class: "band-area", d: `M${highPoints.join("L")}L${[...lowPoints].reverse().join("L")}Z` }));
  svg.append(createSvgElement("path", { class: "band-edge", d: `M${highPoints.join("L")}` }));
  svg.append(createSvgElement("path", { class: "band-edge", d: `M${lowPoints.join("L")}` }));
}

// Moving the pointer over the chart shows that day's total and each part. Returns the tooltip element.
function addHoverCrosshair({ svg, dates, layers, totals, totalName, width, height, margins, xOfIndex, yOfValue, forecastFromIndex, band }) {
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
    const isForecast = forecastFromIndex !== null && nearestIndex > forecastFromIndex;
    const bandRow = band && band.low[nearestIndex] !== null && nearestIndex > (forecastFromIndex ?? -1)
      ? [createElement("span", "tip-row tip-band", `${band.label}: ${euroFormatter.format(band.low[nearestIndex])} – ${euroFormatter.format(band.high[nearestIndex])}`)]
      : [];
    tooltip.replaceChildren(document.createTextNode(`${isForecast ? "Forecast · " : ""}${totalName} · ${formatShortDate(dates[nearestIndex], true)}`),
      createElement("strong", "", euroFormatter.format(totals[nearestIndex])), ...layerRows, ...bandRow);
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
