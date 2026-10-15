/* BUDGETS: set an expense category's monthly limit, and this month's progress (Insights).
 * The maths is in services/budgetCalculator.js; Statements get their "Budget vs actual" from
 * services/financialStatements.js, for the same period as the rest of the page.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { convertEurosToCents, convertCentsToEuros } = require("../utils/moneyConversion.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { buildMonthBudgetProgress } = require("../services/budgetCalculator.js");

const router = express.Router();

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// The limit that applies just before `fromMonth` (null = none), to know whether a change really changes anything
const selectLimitBeforeMonth = db.prepare(`
  SELECT monthly_limit FROM category_budgets WHERE category_id = ? AND from_month < ? ORDER BY from_month DESC LIMIT 1
`);

// Set or remove an expense category's monthly budget: { monthly_limit } in euros; empty or null = no budget.
// It applies from `from_month` (YYYY-MM, default: this month) on; earlier months keep the limit they had
// (see migration 11). Setting it again in the same month replaces that month's value. Setting it back to
// what the previous months already had just removes this month's row: nothing changed, nothing to store.
router.put("/categories/:id/budget", function setCategoryBudget(request, response) {
  const categoryId = Number(request.params.id);
  const category = db.prepare(`SELECT id, name, kind FROM categories WHERE id = ?`).get(categoryId);
  if (!category) return response.status(404).json({ error: "Category not found" });
  if (category.kind !== "expense") return response.status(400).json({ error: `${category.name} is an income category: only expense categories have budgets` });

  const limitSent = request.body?.monthly_limit;
  const removesBudget = limitSent === null || limitSent === undefined || limitSent === "" || Number(limitSent) === 0;
  const newLimit = removesBudget ? null : convertEurosToCents(limitSent);
  if (!removesBudget && !(newLimit > 0)) return response.status(400).json({ error: "the monthly budget must be an amount above 0 (empty = no budget)" });

  const fromMonth = request.body?.from_month || getTodayAsLocalDate().slice(0, 7);
  if (!MONTH_PATTERN.test(fromMonth)) return response.status(400).json({ error: "from_month must be YYYY-MM" });

  const limitBefore = selectLimitBeforeMonth.get(categoryId, fromMonth)?.monthly_limit ?? null;
  db.transaction(() => {
    if (newLimit === limitBefore) {
      db.prepare(`DELETE FROM category_budgets WHERE category_id = ? AND from_month = ?`).run(categoryId, fromMonth);
    } else {
      db.prepare(`
        INSERT INTO category_budgets (category_id, from_month, monthly_limit) VALUES (?, ?, ?)
        ON CONFLICT (category_id, from_month) DO UPDATE SET monthly_limit = excluded.monthly_limit
      `).run(categoryId, fromMonth, newLimit);
    }
  })();
  response.json({ category_id: categoryId, from_month: fromMonth, monthly_limit: convertCentsToEuros(newLimit) });
});

// Insights > This month: each budgeted category's spending so far, its limit and the month-end projection
router.get("/budgets/this-month", function getThisMonthBudgets(request, response) {
  response.json(buildMonthBudgetProgress(getTodayAsLocalDate()));
});

module.exports = router;
