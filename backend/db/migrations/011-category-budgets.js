/* MIGRATION 11. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 11: monthly budgets per expense category ----
// A budget is a monthly spending limit for one expense category ("Groceries: 300 € a month").
// No envelopes, no rollover: each month is compared with its own limit, and what's left over doesn't carry on.
//
// Limits keep their history: each row says "from this month on, the limit is X", and the limit of any month
// is the newest row on or before it. So raising Groceries from 300 to 400 € in November leaves every month up
// to October judged against the 300 € it really had, and Statements for a past period don't change after the
// fact. Setting the limit again in the same month replaces that month's row (only the newest value of a month
// counts), so the table only grows when a limit really changes from one month to another.
// A row with monthly_limit NULL means "no budget from this month on" (removing a budget keeps the old months).
//
// Only expense categories get budgets (routes/budgetRoutes.js refuses the others). The rows point to the category
// by id and go with it when it's deleted, or merged into another (the merged one is deleted: ON DELETE CASCADE).
function createCategoryBudgetsTable(db) {
  db.exec(`
    CREATE TABLE category_budgets (
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      from_month TEXT NOT NULL CHECK (from_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),  -- YYYY-MM
      monthly_limit INTEGER CHECK (monthly_limit IS NULL OR monthly_limit > 0),            -- cents; NULL = no budget
      PRIMARY KEY (category_id, from_month)   -- one value per category per month
    ) WITHOUT ROWID;
  `);
}

module.exports = createCategoryBudgetsTable;
