// ---- small helpers to find and build page elements ----

import { areAmountsHidden, HIDDEN_AMOUNT } from "./formatting.js";
import { makeDecimalFieldCommaFriendly } from "./decimalInputs.js";

export const elementById = (id) => document.getElementById(id);

// createElement("span", "pos", "+5,00 €") -> <span class="pos">+5,00 €</span>
export function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

// The coloured label showing a transaction type or a trade side ("expense", "buy"...)
export const createTypeBadge = (type) => createElement("span", `badge ${type}`, type);

// Fills a table body, one row per item. createCells(item) returns the row's cells:
// text values or DOM nodes.
export function fillTableBody(tableBodyId, items, createCells) {
  const tableBody = elementById(tableBodyId);
  tableBody.replaceChildren();
  for (const item of items) {
    const tableRow = document.createElement("tr");
    for (const cell of createCells(item)) {
      const tableCell = document.createElement("td");
      if (cell instanceof Node) tableCell.append(cell);
      else tableCell.textContent = cell ?? "";
      tableRow.append(tableCell);
    }
    tableBody.append(tableRow);
  }
}

// Replaces a dropdown's options, keeping the current choice when it's still there.
// options: [{ value, label }]. The value is what the form sends (e.g. an account id), the label what you see.
export function replaceSelectOptions(selectElement, options, emptyOptionLabel) {
  const currentValue = selectElement.value;
  selectElement.replaceChildren(new Option(emptyOptionLabel, ""));
  for (const option of options) selectElement.append(new Option(option.label, option.value));
  selectElement.value = currentValue;
}

// Makes every row of a table body clickable (and openable with Enter), each opening its own item
export function makeTableRowsOpenItems(tableBodyId, items, openItem, getTitle = () => "Click to edit") {
  [...elementById(tableBodyId).rows].forEach((tableRow, index) => {
    tableRow.classList.add("clickable");
    tableRow.tabIndex = 0;
    tableRow.title = getTitle(items[index]);
    tableRow.onclick = () => openItem(items[index]);
    tableRow.onkeydown = (event) => { if (event.key === "Enter") openItem(items[index]); };
  });
}

// Chip rows (Settings, chart ranges): marks the chip whose data-value is selected
export function highlightSelectedChip(chipContainer, selectedValue, dataAttributeName = "value") {
  for (const chip of chipContainer.children) chip.classList.toggle("active", chip.dataset[dataAttributeName] === selectedValue);
}

// An amount field filled in from your data (a budget, a forecast phase, a counted balance): with Hide amounts on it
// shows ***** until you click into it, then the real value to edit, and ***** again when you leave. Editing works
// as usual: the field's own "change" handler sees the real value, since the stars are only put back on blur.
export function hideAmountFieldWhenAmountsHidden(input) {
  makeDecimalFieldCommaFriendly(input); // first: on phones the field's real type is text (core/decimalInputs.js)
  if (!areAmountsHidden() || input.value === "") return;
  const realType = input.type;
  let realValue = input.value;
  const showStars = () => {
    if (!areAmountsHidden() || input.value === "") return;
    realValue = input.value;
    input.type = "text";
    input.value = HIDDEN_AMOUNT;
  };
  input.addEventListener("focus", () => {
    if (input.value !== HIDDEN_AMOUNT) return;
    input.type = realType;
    input.value = realValue;
  });
  input.addEventListener("blur", showStars);
  showStars();
}
