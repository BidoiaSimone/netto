// ---- Sankey chart (SVG): money flowing from the boxes on the left, through one middle bar, to the boxes on the right ----
// Drawing only: it gets boxes with a label and an amount, and knows nothing about statements. Each box's height is
// its amount; each band is as thick as the money it carries. With one middle bar every band is simply one box's
// amount, so the left bands stack down the middle bar's left edge in order, and the right bands down its right edge.
//
//   sources / uses: [{ key, label, amount, kind }]   kind -> the colour class (income, expense, investments, savings)
//   options.onPick(box, side): called when a band or box is hovered, tapped or focused (to show its detail)
//   options.formatAmount(amount): how amounts are written next to the boxes

import { createSvgElement } from "./svgHelpers.js";

const LABEL_WIDTH = 168;    // room for the names and amounts on each side
const BOX_WIDTH = 12;
const GAP_BETWEEN_BOXES = 8;
const PIXELS_PER_BOX = 34;  // the chart grows taller with more boxes, so small ones still have room for their label
const MINIMUM_HEIGHT = 240;
const MARGIN = { top: 8, bottom: 8 };

// Each label wants to sit at its box's centre, but a label is two lines (~28 px) and thin boxes can be 1 px apart:
// labels are pushed down until none overlaps the one above, then back up if the last ones fell off the bottom.
const LABEL_HEIGHT = 28;
function spreadLabels(wantedCentres, chartHeight) {
  const centres = [];
  wantedCentres.forEach((wanted, index) => { centres.push(index ? Math.max(wanted, centres[index - 1] + LABEL_HEIGHT) : Math.max(wanted, LABEL_HEIGHT / 2)); });
  const lowestAllowed = chartHeight - LABEL_HEIGHT / 2;
  for (let index = centres.length - 1; index >= 0; index--) {
    const limit = index === centres.length - 1 ? lowestAllowed : centres[index + 1] - LABEL_HEIGHT;
    if (centres[index] > limit) centres[index] = limit;
  }
  return centres;
}

export function drawSankeyChart(container, { sources, uses, total, middleLabel }, { onPick = () => {}, formatAmount = String } = {}) {
  const width = Math.max(container.clientWidth || 640, 560);
  const boxCount = Math.max(sources.length, uses.length);
  const height = Math.max(MINIMUM_HEIGHT, boxCount * PIXELS_PER_BOX) + MARGIN.top + MARGIN.bottom;
  const svg = createSvgElement("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": `Money flows: ${middleLabel}` });
  if (!(total > 0)) {
    container.replaceChildren(svg);
    return;
  }

  // one scale for both sides, set by the side with more gaps: both columns then fit the same height
  const usableHeight = height - MARGIN.top - MARGIN.bottom - GAP_BETWEEN_BOXES * (boxCount - 1);
  const pixelsPerEuro = usableHeight / total;
  const middleHeight = total * pixelsPerEuro;
  const middleTop = MARGIN.top + (height - MARGIN.top - MARGIN.bottom - middleHeight) / 2;
  const leftX = LABEL_WIDTH, middleX = width / 2 - BOX_WIDTH / 2, rightX = width - LABEL_WIDTH - BOX_WIDTH;

  // each side's boxes, top to bottom, centred in the height; and where each one's band meets the middle bar
  const placeBoxes = (boxes) => {
    const boxesHeight = boxes.reduce((sum, box) => sum + box.amount * pixelsPerEuro, 0) + GAP_BETWEEN_BOXES * (boxes.length - 1);
    let boxTop = MARGIN.top + (height - MARGIN.top - MARGIN.bottom - boxesHeight) / 2;
    let middleCursor = middleTop;
    return boxes.map((box) => {
      const boxHeight = box.amount * pixelsPerEuro;
      const placed = { box, top: boxTop, height: boxHeight, middleTop: middleCursor };
      boxTop += boxHeight + GAP_BETWEEN_BOXES;
      middleCursor += boxHeight;
      return placed;
    });
  };

  // a band from (x1, y1…y1+h) to (x2, y2…y2+h), curved half-way
  const bandPath = (x1, y1, x2, y2, bandHeight) => {
    const curveX = (x1 + x2) / 2;
    return `M${x1},${y1} C${curveX},${y1} ${curveX},${y2} ${x2},${y2} L${x2},${y2 + bandHeight} C${curveX},${y2 + bandHeight} ${curveX},${y1 + bandHeight} ${x1},${y1 + bandHeight} Z`;
  };

  const bandsGroup = createSvgElement("g", { class: "sankey-bands" });
  const boxesGroup = createSvgElement("g", { class: "sankey-boxes" });
  const labelsGroup = createSvgElement("g", { class: "sankey-labels" });
  const allBands = [];

  const drawSide = (placedBoxes, side) => {
    const labelCentres = spreadLabels(placedBoxes.map(({ top, height: boxHeight }) => top + boxHeight / 2), height);
    placedBoxes.forEach(({ box, top, height: boxHeight, middleTop: bandMiddleTop }, index) => {
      const band = side === "source"
        ? createSvgElement("path", { d: bandPath(leftX + BOX_WIDTH, top, middleX, bandMiddleTop, boxHeight), class: `sankey-band ${box.kind}` })
        : createSvgElement("path", { d: bandPath(middleX + BOX_WIDTH, bandMiddleTop, rightX, top, boxHeight), class: `sankey-band ${box.kind}` });
      const boxRectangle = createSvgElement("rect", { x: side === "source" ? leftX : rightX, y: top, width: BOX_WIDTH, height: Math.max(boxHeight, 1), rx: 2, class: `sankey-box ${box.kind}` });
      // focusable, so the detail can be read with the keyboard too; a tap on a phone counts as a pick
      for (const element of [band, boxRectangle]) {
        element.setAttribute("tabindex", "0");
        const pick = () => {
          allBands.forEach((otherBand) => otherBand.classList.toggle("active", otherBand === band));
          onPick(box, side);
        };
        element.addEventListener("pointerenter", pick);
        element.addEventListener("click", pick);
        element.addEventListener("focus", pick);
      }
      allBands.push(band);
      bandsGroup.append(band);
      boxesGroup.append(boxRectangle);

      const labelX = side === "source" ? leftX - 8 : rightX + BOX_WIDTH + 8;
      const anchor = side === "source" ? "end" : "start";
      const boxCentreY = top + boxHeight / 2, labelCentreY = labelCentres[index];
      // a label pushed away from a thin box gets a short line back to it
      if (Math.abs(labelCentreY - boxCentreY) > 4) {
        const boxEdgeX = side === "source" ? leftX : rightX + BOX_WIDTH;
        const lineEndX = side === "source" ? labelX + 4 : labelX - 4;
        labelsGroup.append(createSvgElement("path", { d: `M${boxEdgeX},${boxCentreY} L${lineEndX},${labelCentreY - 6}`, class: "sankey-leader" }));
      }
      const name = createSvgElement("text", { x: labelX, y: labelCentreY - 2, "text-anchor": anchor, class: "sankey-name" });
      name.textContent = box.label.length > 24 ? `${box.label.slice(0, 23)}…` : box.label;
      const amount = createSvgElement("text", { x: labelX, y: labelCentreY + 12, "text-anchor": anchor, class: "sankey-amount" });
      amount.textContent = formatAmount(box.amount);
      labelsGroup.append(name, amount);
    });
  };
  drawSide(placeBoxes(sources), "source");
  drawSide(placeBoxes(uses), "use");

  // the middle bar is the period's total: its label is written above the chart by the page, where there's room
  const middle = createSvgElement("rect", { x: middleX, y: middleTop, width: BOX_WIDTH, height: middleHeight, rx: 2, class: "sankey-box middle" });
  middle.append(Object.assign(createSvgElement("title", {}), { textContent: `${middleLabel}: ${formatAmount(total)}` }));
  svg.append(bandsGroup, boxesGroup, middle, labelsGroup);
  svg.addEventListener("pointerleave", () => allBands.forEach((band) => band.classList.remove("active")));
  container.replaceChildren(svg);
}
