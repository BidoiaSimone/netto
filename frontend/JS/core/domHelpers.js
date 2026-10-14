// ---- small helpers to find and build page elements ----

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
