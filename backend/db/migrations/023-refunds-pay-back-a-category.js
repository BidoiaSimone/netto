/* MIGRATION 23. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 23: a refund pays back an expense category ----
// A friend gives you back 25 € of the dinner you paid for: the money comes in (an income, so the account balance
// is right), but what you really spent on Food was the dinner minus 25 €. An income can now name the expense
// category it pays back:
//
//   transactions.refund_category_id   the expense category this income pays back (null: an ordinary income).
//                                     Only incomes have one (validation/transactionValidation.js).
//
// Every total of income and spending (goals, budgets, Insights' trends, the wrap-up, Statements, Year in review,
// the forecast, the tag report) reads the view below instead of the table, where a refund is not an income but a
// negative expense in that category. So income − expenses stays exactly the same, and the 25 € comes off Food.
//
//   income_and_spending   one row per income and expense; a refund there has type 'expense', its amount negative
//                         and its category the one it pays back (is_refund = 1)
//
// Deleting the category makes the refund an ordinary income again (ON DELETE SET NULL).
// A later migration that rebuilds the transactions table must drop this view first and create it again.
function addRefundCategories(db) {
  db.exec(`
    ALTER TABLE transactions ADD COLUMN refund_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
    CREATE VIEW income_and_spending AS
      SELECT id, date, description, from_account_id, to_account_id, recurring_transaction_id,
             CASE WHEN type = 'income' AND refund_category_id IS NOT NULL THEN 'expense' ELSE type END AS type,
             CASE WHEN type = 'income' AND refund_category_id IS NOT NULL THEN -amount ELSE amount END AS amount,
             CASE WHEN type = 'income' AND refund_category_id IS NOT NULL THEN refund_category_id ELSE category_id END AS category_id,
             (type = 'income' AND refund_category_id IS NOT NULL) AS is_refund
      FROM transactions
      WHERE type IN ('income', 'expense');
  `);
}

module.exports = addRefundCategories;
