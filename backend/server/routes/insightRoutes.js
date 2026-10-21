/* INSIGHTS THAT ARE WORKED OUT ON THE SERVER
 *   GET /insights/category-trends       each expense category this month vs its usual average (services/categoryTrends.js)
 *   GET /reconciliation-reminders       the accounts due to be counted again (services/reconciliationReminders.js)
 *   GET /insights/monthly-expenses      what a month usually costs, for the emergency fund (services/forecast.js:
 *                                       the same average the Forecast starts from, but always real spending, never budgets)
 * The first two read their thresholds from the settings (config/appSettings.js).
 */

const express = require("express");
const { buildCategoryTrends } = require("../services/categoryTrends.js");
const { listAccountsToReconcile } = require("../services/reconciliationReminders.js");
const { calculateRealAverages } = require("../services/forecast.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

const router = express.Router();

router.get("/insights/category-trends", function getCategoryTrends(request, response) {
  response.json(buildCategoryTrends());
});

router.get("/reconciliation-reminders", function getReconciliationReminders(request, response) {
  response.json(listAccountsToReconcile());
});

// { monthly_expenses (euros), months_of_data (0 = this month so far, projected to its end), source (a sentence) }
router.get("/insights/monthly-expenses", function getMonthlyExpenses(request, response) {
  const averages = calculateRealAverages(getTodayAsLocalDate(), { useBudgets: false });
  response.json({
    monthly_expenses: convertCentsToEuros(averages.monthlyExpenses),
    months_of_data: averages.monthsOfData,
    source: averages.source,
  });
});

module.exports = router;
