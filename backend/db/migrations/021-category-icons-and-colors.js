/* MIGRATION 21. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 21: each category's icon and colour ----
// Pocket's lists lead every transaction with a round icon: a white line drawing on a solid colour. Until now that
// was the category's initial on a colour guessed from its name; now each category can pick both itself (Categories
// page). Two plain text columns, both optional:
//   icon   the name of a drawing in frontend/JS/core/categoryIcons.js ("cart", "pills"…); NULL = the initial
//   color  "#rrggbb", one of the palette in that same file; NULL = the colour guessed from the name, as before
// The server only checks their shape: which drawings and colours exist is the frontend's business, and one it
// doesn't know (an old backup, a drawing removed later) simply shows as the initial.
//
// Existing databases: the categories Simone already had get a matching icon and colour; any other name starts empty
// and can be set on the Categories page.
const LOOKS_OF_EXISTING_CATEGORIES = [
  // expenses
  ["expense", "Grocery", "cart", "#2f9e44"],
  ["expense", "Food", "fork-knife", "#e46a2c"],
  ["expense", "Coffee", "coffee", "#9a6b4b"],
  ["expense", "Transport", "bus", "#3478f6"],
  ["expense", "Car", "car", "#5f6b73"],
  ["expense", "Rent", "home", "#0f9b8e"],
  ["expense", "Utility - Electricity", "bolt", "#b77900"],
  ["expense", "Utility - Gas", "flame", "#e0484e"],
  ["expense", "Utility - Water", "drop", "#1597b8"],
  ["expense", "Medicine", "pills", "#d6408a"],
  ["expense", "Gift", "gift", "#8e5bd6"],
  ["expense", "Clothes", "shirt", "#5b5bd6"],
  ["expense", "Products", "box", "#2d4f8a"],
  ["expense", "Service", "wrench", "#5f8c17"],
  ["expense", "Leisure", "ticket", "#e66767"],
  // income
  ["income", "Salary - Office", "briefcase", "#3478f6"],
  ["income", "Salary - Chiosco", "kiosk", "#e46a2c"],
  ["income", "Income - INPS", "landmark", "#2d4f8a"],
  ["income", "Interest", "percent", "#2f9e44"],
  ["income", "Refunds", "refund", "#0f9b8e"],
  ["income", "Gifts received", "gift", "#8e5bd6"],
  ["income", "Vouchers", "voucher", "#b77900"],
  ["income", "Other income", "coins", "#5f6b73"],
];

function addCategoryIconsAndColors(db) {
  db.exec(`
    ALTER TABLE categories ADD COLUMN icon TEXT;
    ALTER TABLE categories ADD COLUMN color TEXT;
  `);
  const setLook = db.prepare(`UPDATE categories SET icon = ?, color = ? WHERE kind = ? AND name = ?`); // the name column is NOCASE
  for (const [kind, name, icon, color] of LOOKS_OF_EXISTING_CATEGORIES) setLook.run(icon, color, kind, name);
}

module.exports = addCategoryIconsAndColors;
