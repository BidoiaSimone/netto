// ---- building SVG charts by hand ----

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// createSvgElement("circle", { cx: 10, cy: 10, r: 5 }) -> <circle cx="10" cy="10" r="5">
export function createSvgElement(tagName, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);
  for (const name in attributes) element.setAttribute(name, attributes[name]);
  return element;
}
