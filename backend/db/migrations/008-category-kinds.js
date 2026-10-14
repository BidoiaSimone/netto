/* MIGRATION 8. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 8: income and expense categories ----
// Every category gets a kind: 'income' (Salary, Refund...) or 'expense' (Rent, Groceries...), and an
// income can only use income categories, an expense only expense ones (validation/transactionValidation.js).
// The same name may now exist once per kind ("Gift" received and "Gift" given), so the UNIQUE name
// becomes UNIQUE name + kind. SQLite can't change a constraint, so the table is rebuilt; the other
// tables point to categories by id, which the copy keeps, so nothing else needs to change.
//
// Existing categories get their kind from how they were used (assignCategoryKindsFromUsage below).
function addCategoryKinds(db) {
  db.exec(`
    CREATE TABLE categories_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('income', 'expense')),
      UNIQUE (name, kind)
    );
    INSERT INTO categories_new (id, name, kind) SELECT id, name, 'expense' FROM categories;
    DROP TABLE categories;
    ALTER TABLE categories_new RENAME TO categories;
  `);
  assignCategoryKindsFromUsage(db);
}

// Gives each category the kind its transactions and recurring transactions say it has:
//   used only by incomes                -> income
//   used only by expenses, or by nothing -> expense (the default)
//   used by both                        -> stays expense, and an income twin with the same name is
//                                          created for its incomes, so no transaction loses its category
// Movements and reconciliations don't decide anything: they may keep a category of either kind.
// Also used when restoring a JSON backup made before version 8 (services/jsonBackupImport.js).
function assignCategoryKindsFromUsage(db) {
  const usageOfEachCategory = db.prepare(`
    SELECT c.id, c.name,
      (SELECT COUNT(*) FROM transactions WHERE category_id = c.id AND type = 'income')
        + (SELECT COUNT(*) FROM recurring_transactions WHERE category_id = c.id AND type = 'income') AS incomeUses,
      (SELECT COUNT(*) FROM transactions WHERE category_id = c.id AND type = 'expense')
        + (SELECT COUNT(*) FROM recurring_transactions WHERE category_id = c.id AND type = 'expense') AS expenseUses
    FROM categories c
  `).all();

  for (const category of usageOfEachCategory) {
    if (category.incomeUses === 0) continue;
    if (category.expenseUses === 0) {
      db.prepare(`UPDATE categories SET kind = 'income' WHERE id = ?`).run(category.id);
      continue;
    }
    const incomeTwinId = db.prepare(`INSERT INTO categories (name, kind) VALUES (?, 'income')`).run(category.name).lastInsertRowid;
    db.prepare(`UPDATE transactions SET category_id = ? WHERE category_id = ? AND type = 'income'`).run(incomeTwinId, category.id);
    db.prepare(`UPDATE recurring_transactions SET category_id = ? WHERE category_id = ? AND type = 'income'`).run(incomeTwinId, category.id);
  }
}

module.exports = addCategoryKinds;
module.exports.assignCategoryKindsFromUsage = assignCategoryKindsFromUsage;
