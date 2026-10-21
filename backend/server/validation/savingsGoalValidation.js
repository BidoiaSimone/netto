/* CHECKS A GOAL SENT BY THE FRONTEND (Goals page): POST /savings-goals and PUT /savings-goals/:id
 *   { name, target (euros), start_date?, categories: [{ category_id, monthly_baseline (euros) }] }
 * No start date = today. Every category must be an existing expense category, each at most once.
 */

const db = require("../../db/databaseConnection.js");
const { isRealCalendarDate, getTodayAsLocalDate } = require("../utils/localDates.js");
const { convertEurosToCents } = require("../utils/moneyConversion.js");

const MAXIMUM_GOAL_NAME_LENGTH = 60;
const selectExpenseCategory = db.prepare(`SELECT id FROM categories WHERE id = ? AND kind = 'expense'`);

// Returns { goal: { name, target, startDate, categories: [{ categoryId, monthlyBaseline }] } } (cents) or { error }
function validateSavingsGoal(requestBody = {}) {
  const name = String(requestBody.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "a goal needs a name" };
  if (name.length > MAXIMUM_GOAL_NAME_LENGTH) return { error: `a goal name can be at most ${MAXIMUM_GOAL_NAME_LENGTH} characters` };

  const target = convertEurosToCents(requestBody.target);
  if (!(target > 0)) return { error: "the target must be an amount above 0" };

  const startDate = requestBody.start_date ? String(requestBody.start_date) : getTodayAsLocalDate();
  if (!isRealCalendarDate(startDate)) return { error: "start date must be a valid YYYY-MM-DD date" };

  if (!Array.isArray(requestBody.categories) || !requestBody.categories.length) return { error: "pick at least one category to cut back on" };
  const categories = [];
  for (const sent of requestBody.categories) {
    const categoryId = Number(sent?.category_id);
    if (!Number.isInteger(categoryId) || !selectExpenseCategory.get(categoryId)) return { error: "every category must be an existing expense category" };
    if (categories.some((category) => category.categoryId === categoryId)) return { error: "the same category is in the list twice" };
    const monthlyBaseline = convertEurosToCents(sent.monthly_baseline);
    if (!(monthlyBaseline >= 0)) return { error: "each category needs what it normally costs a month (0 or more)" };
    categories.push({ categoryId, monthlyBaseline });
  }
  if (categories.every((category) => category.monthlyBaseline === 0)) {
    return { error: "with every baseline at 0 there's nothing to cut back from: set what they normally cost" };
  }
  return { goal: { name, target, startDate, categories } };
}

module.exports = { validateSavingsGoal };
