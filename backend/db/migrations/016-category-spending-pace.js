/* MIGRATION 16. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 16: how each expense category is spent: a bit every day, or once in a while ----
// The month projections (Insights > This month, the budget bars, category trends) guess the rest of the month
// from the pace so far: spent ÷ days passed × days in the month. That's right for groceries or coffee, which you
// buy all month long, but wrong for rent, gifts or a new phone: one 600 € purchase on the 3rd doesn't mean
// another 600 € every three days. So each category now says which kind it is:
//   'daily'       spread over the month: the rest of the month is projected at this month's daily pace (the default)
//   'occasional'  one-off purchases: what's spent so far stays as it is, nothing more is guessed on top
// Recurring transactions are unaffected either way: they are counted by their dates, whatever the category.
// The value only means something for expense categories; income ones keep the default and nobody reads it.
//
// Existing databases: Rent, Products and Gift(s) start as 'occasional' (the ones Simone named); everything else
// starts as 'daily' and can be switched on the Categories page.
function addCategorySpendingPace(db) {
  db.exec(`
    ALTER TABLE categories ADD COLUMN spending_pace TEXT NOT NULL DEFAULT 'daily'
      CHECK (spending_pace IN ('daily', 'occasional'));
    UPDATE categories SET spending_pace = 'occasional'
      WHERE kind = 'expense' AND name IN ('Rent', 'Products', 'Product', 'Gift', 'Gifts');  -- the column is NOCASE
  `);
}

module.exports = addCategorySpendingPace;
