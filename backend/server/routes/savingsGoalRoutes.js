/* GOALS PAID FOR BY CUTTING BACK (Goals page). The maths: services/savingsGoals.js.
 *   GET    /savings-goals                every goal, in queue order, with its progress
 *   GET    /savings-goals/baselines      what each expense category usually costs a month (to fill in a new goal)
 *   POST   /savings-goals                { name, target, start_date?, categories: [{ category_id, monthly_baseline }] }
 *   PUT    /savings-goals/order          { goal_ids: [...] } the whole queue, first = filled first
 *   PUT    /savings-goals/:id            the whole goal again, like adding one
 *   PUT    /savings-goals/:id/purchase   { transaction_id } the expense that bought it (its amount becomes the target), or null to unlink it
 *   DELETE /savings-goals/:id
 * Money in euros in and out; cents in the database.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { calculateGoalProgress, suggestBaselines } = require("../services/savingsGoals.js");
const { validateSavingsGoal } = require("../validation/savingsGoalValidation.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

const router = express.Router();
const toEuros = convertCentsToEuros;

const goalToApi = (goal) => ({
  ...goal,
  target: toEuros(goal.target),
  planned_target: toEuros(goal.planned_target),
  saved: toEuros(goal.saved),
  monthly_pace: toEuros(goal.monthly_pace),
  categories: goal.categories.map((category) => ({ ...category, monthly_baseline: toEuros(category.monthly_baseline), saved: toEuros(category.saved) })),
  months: goal.months.map((row) => ({ ...row, baseline: toEuros(row.baseline), spent: toEuros(row.spent), saved: toEuros(row.saved), carried_in: toEuros(row.carried_in) })),
  purchase: goal.purchase && { ...goal.purchase, amount: toEuros(goal.purchase.amount) },
});

router.get("/savings-goals", function listSavingsGoals(request, response) {
  response.json(calculateGoalProgress(getTodayAsLocalDate()).map(goalToApi));
});

router.get("/savings-goals/baselines", function getSuggestedBaselines(request, response) {
  const suggestion = suggestBaselines(getTodayAsLocalDate());
  response.json({ ...suggestion, categories: suggestion.categories.map((category) => ({ ...category, monthly_average: toEuros(category.monthly_average) })) });
});

const insertGoalCategory = db.prepare(`INSERT INTO savings_goal_categories (goal_id, category_id, monthly_baseline) VALUES (?, ?, ?)`);
const selectGoal = db.prepare(`SELECT id FROM savings_goals WHERE id = ?`);

// A new goal goes to the end of the queue
router.post("/savings-goals", function addSavingsGoal(request, response) {
  const { error, goal } = validateSavingsGoal(request.body);
  if (error) return response.status(400).json({ error });
  const goalId = db.transaction(() => {
    const lastPosition = db.prepare(`SELECT COALESCE(MAX(position), 0) AS last FROM savings_goals`).get().last;
    const { lastInsertRowid } = db.prepare(`INSERT INTO savings_goals (name, target, start_date, position, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(goal.name, goal.target, goal.startDate, lastPosition + 1, getTodayAsLocalDate());
    for (const category of goal.categories) insertGoalCategory.run(lastInsertRowid, category.categoryId, category.monthlyBaseline);
    return lastInsertRowid;
  })();
  response.status(201).json({ id: goalId });
});

// Registered before /savings-goals/:id, or "order" would be read as an id
router.put("/savings-goals/order", function reorderSavingsGoals(request, response) {
  const goalIds = request.body?.goal_ids;
  const existingIds = db.prepare(`SELECT id FROM savings_goals`).all().map((row) => row.id);
  const isSameSet = Array.isArray(goalIds) && goalIds.length === existingIds.length
    && new Set(goalIds.map(Number)).size === existingIds.length && goalIds.every((id) => existingIds.includes(Number(id)));
  if (!isSameSet) return response.status(400).json({ error: "goal_ids must list every goal exactly once" });
  db.transaction(() => {
    goalIds.forEach((id, index) => db.prepare(`UPDATE savings_goals SET position = ? WHERE id = ?`).run(index + 1, Number(id)));
  })();
  response.json({ goal_ids: goalIds.map(Number) });
});

router.put("/savings-goals/:id", function editSavingsGoal(request, response) {
  const goalId = Number(request.params.id);
  if (!selectGoal.get(goalId)) return response.status(404).json({ error: "Goal not found" });
  const { error, goal } = validateSavingsGoal(request.body);
  if (error) return response.status(400).json({ error });
  db.transaction(() => {
    db.prepare(`UPDATE savings_goals SET name = ?, target = ?, start_date = ? WHERE id = ?`).run(goal.name, goal.target, goal.startDate, goalId);
    db.prepare(`DELETE FROM savings_goal_categories WHERE goal_id = ?`).run(goalId);
    for (const category of goal.categories) insertGoalCategory.run(goalId, category.categoryId, category.monthlyBaseline);
  })();
  response.json({ id: goalId });
});

// The purchase must be an expense, and can pay for one goal only
router.put("/savings-goals/:id/purchase", function linkPurchase(request, response) {
  const goalId = Number(request.params.id);
  if (!selectGoal.get(goalId)) return response.status(404).json({ error: "Goal not found" });
  const sentId = request.body?.transaction_id;
  if (sentId === null || sentId === undefined || sentId === "") {
    db.prepare(`UPDATE savings_goals SET purchase_transaction_id = NULL WHERE id = ?`).run(goalId);
    return response.json({ id: goalId, purchase_transaction_id: null });
  }
  const transactionId = Number(sentId);
  const transaction = db.prepare(`SELECT id, type FROM transactions WHERE id = ?`).get(transactionId);
  if (!transaction) return response.status(404).json({ error: "Transaction not found" });
  if (transaction.type !== "expense") return response.status(400).json({ error: "the purchase must be an expense" });
  const otherGoal = db.prepare(`SELECT name FROM savings_goals WHERE purchase_transaction_id = ? AND id <> ?`).get(transactionId, goalId);
  if (otherGoal) return response.status(409).json({ error: `that expense already paid for ${otherGoal.name}` });
  db.prepare(`UPDATE savings_goals SET purchase_transaction_id = ? WHERE id = ?`).run(transactionId, goalId);
  response.json({ id: goalId, purchase_transaction_id: transactionId });
});

// The goals after it move up one place
router.delete("/savings-goals/:id", function deleteSavingsGoal(request, response) {
  const goalId = Number(request.params.id);
  const goal = db.prepare(`SELECT id, position FROM savings_goals WHERE id = ?`).get(goalId);
  if (!goal) return response.status(404).json({ error: "Goal not found" });
  db.transaction(() => {
    db.prepare(`DELETE FROM savings_goals WHERE id = ?`).run(goalId);
    db.prepare(`UPDATE savings_goals SET position = position - 1 WHERE position > ?`).run(goal.position);
  })();
  response.status(204).end();
});

module.exports = router;
