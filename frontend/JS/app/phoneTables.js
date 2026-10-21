// ---- phones: wide tables scroll sideways inside a box of their own ----
// A table that's wider than the screen must not make the whole page wider. Making the table itself scroll
// (display: block) also made every narrow table shrink to its content instead of filling the card, so on phones
// each table is put inside a <div class="table-scroll"> that scrolls instead (31-phone.css), and stays a real
// table, as wide as its card. Tables added later (Statements, the import preview…) are wrapped as they appear.
// The transactions list (a list of small cards on phones) and tables that already scroll in their own box are
// left as they are.

const PHONE_WIDTH = "(max-width: 800px)";
const ALREADY_SCROLLING = ".table-scroll, .goal-months-scroll, .ot-scroll";

function wrapTable(table) {
  if (table.classList.contains("transactions-table") || table.parentElement?.closest(ALREADY_SCROLLING) || !table.closest("main, dialog")) return;
  const box = document.createElement("div");
  box.className = "table-scroll";
  table.replaceWith(box);
  box.append(table);
}

function wrapTablesIn(root) {
  if (root instanceof HTMLTableElement) wrapTable(root);
  root.querySelectorAll?.("table").forEach(wrapTable);
}

export function initializePhoneTables() {
  if (!window.matchMedia(PHONE_WIDTH).matches) return;
  wrapTablesIn(document);
  new MutationObserver((changes) => changes.forEach((change) => change.addedNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === "TABLE" || node.querySelector?.("table"))) wrapTablesIn(node);
  }))).observe(document.body, { childList: true, subtree: true });
}
