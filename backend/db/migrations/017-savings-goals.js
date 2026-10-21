/* MIGRATION 17. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 17: goals paid for by cutting back ----
// A goal is something you'd buy anyway ("MacBook, 1.300 €") and pay for by spending less in some categories
// (Coffee, Food). Each of its categories has a monthly baseline: what that category normally costs you, written
// down when the goal is created and then never recalculated (otherwise it would drop as you cut back, and the
// savings would disappear). Every month, saved = baseline − what you really spent there.
//
//   savings_goals             the goal: name, target, the day it starts counting, its place in the queue
//                             (position 1 is filled first), and the purchase once you've made it
//   savings_goal_categories   which categories pay for it, each with its baseline (cents a month)
//
// The maths (queue, overspending, the purchase) is in backend/server/services/savingsGoals.js.
// purchase_transaction_id: ON DELETE SET NULL, so deleting the purchase just makes the goal "not bought" again.
// The categories: ON DELETE CASCADE both ways (deleting a goal removes its rows; deleting a category removes it
// from the goals). Merging a category into another moves the rows (routes/categoryRoutes.js).
function createSavingsGoalTables(db) {
  db.exec(`
    CREATE TABLE savings_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      target INTEGER NOT NULL CHECK (target > 0),                       -- cents
      start_date TEXT NOT NULL,                                         -- YYYY-MM-DD: savings count from this day
      position INTEGER NOT NULL,                                        -- 1 = filled first
      purchase_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE savings_goal_categories (
      goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      monthly_baseline INTEGER NOT NULL CHECK (monthly_baseline >= 0),  -- cents a month, fixed when the goal was made
      PRIMARY KEY (goal_id, category_id)
    ) WITHOUT ROWID;
  `);
}

module.exports = createSavingsGoalTables;
