/* MIGRATION 22. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 22: income linked to a goal ----
// Money that comes in because of a goal goes straight into it: selling the old MacBook pays for part of the new
// one. An income transaction can be linked to one goal; then its amount counts toward that goal on top of what
// cutting back saves (services/savingsGoals.js). Income that isn't linked never counts toward any goal.
// It stays an ordinary income everywhere else: account balances, Insights, Statements, the forecast.
//
//   savings_goal_incomes   which income goes to which goal. One row per linked transaction (the transaction
//                          is the key: an income pays into one goal at most)
//
// Both ON DELETE CASCADE: deleting the income, or the goal, just removes the link.
function createSavingsGoalIncomesTable(db) {
  db.exec(`
    CREATE TABLE savings_goal_incomes (
      transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
      goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE
    );
    CREATE INDEX savings_goal_incomes_by_goal ON savings_goal_incomes(goal_id);
  `);
}

module.exports = createSavingsGoalIncomesTable;
