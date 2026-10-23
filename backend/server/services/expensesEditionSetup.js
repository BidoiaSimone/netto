/* NETTO EXPENSES: the account and the categories its one page needs (config/edition.js)
 * Expenses.html only asks for an amount and a category, so everything else has to exist already:
 *   - one cash account the expenses are taken from ("Portafoglio"). Its balance goes below zero and nobody looks
 *     at it: this edition counts what is spent, not what is left.
 *   - a few expense categories, each with its icon and colour (migration 21), so the buttons are easy to tell apart.
 * Made only when missing (no open account / no expense category), so it runs safely at every start, and categories
 * renamed, added or deleted later on the Categories page (Home.html) are left as they are.
 */

const { getTodayAsLocalDate } = require("../utils/localDates.js");

const EXPENSES_ACCOUNT_NAME = "Portafoglio";

// name, icon, colour: the buttons, in this order. Icons and colours are those of frontend/JS/core/categoryIcons.js.
const DEFAULT_EXPENSE_CATEGORIES = [
  ["Spesa", "cart", "#2f9e44"],
  ["Bar e caffè", "coffee", "#9a6b4b"],
  ["Ristorante", "fork-knife", "#e46a2c"],
  ["Benzina", "fuel", "#b77900"],
  ["Auto", "car", "#5f6b73"],
  ["Casa e bollette", "home", "#0f9b8e"],
  ["Salute", "pills", "#d6408a"],
  ["Vestiti", "shirt", "#5b5bd6"],
  ["Regali", "gift", "#8e5bd6"],
  ["Svago", "ticket", "#e66767"],
  ["Altro", "dots", "#3a4046"],
];

function prepareExpensesEdition(db) {
  db.transaction(() => {
    const hasOpenAccount = db.prepare(`SELECT 1 FROM accounts WHERE closed_at IS NULL LIMIT 1`).get();
    if (!hasOpenAccount) {
      const today = getTodayAsLocalDate();
      db.prepare(`INSERT INTO accounts (name, kind, opening_balance, balance, open_date, last_reconciled) VALUES (?, 'cash', 0, 0, ?, ?)`)
        .run(EXPENSES_ACCOUNT_NAME, today, today);
    }
    const hasExpenseCategory = db.prepare(`SELECT 1 FROM categories WHERE kind = 'expense' LIMIT 1`).get();
    if (!hasExpenseCategory) {
      const insertCategory = db.prepare(`INSERT OR IGNORE INTO categories (name, kind, icon, color) VALUES (?, 'expense', ?, ?)`);
      for (const [name, icon, color] of DEFAULT_EXPENSE_CATEGORIES) insertCategory.run(name, icon, color);
    }
  })();
}

module.exports = { prepareExpensesEdition, EXPENSES_ACCOUNT_NAME, DEFAULT_EXPENSE_CATEGORIES };
