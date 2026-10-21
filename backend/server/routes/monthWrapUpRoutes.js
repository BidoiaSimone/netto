/* THE MONTH'S WRAP-UP (services/monthWrapUp.js)
 *   GET /month-wrap-up               last month's, if it's still to be shown ({ wrap_up: null } when not)
 *   GET /month-wrap-up?month=2026-10 that month's, shown or not (to look at one again)
 *   GET /month-wrap-up/months        the months that have one, newest first (Settings > Look at a wrap-up again)
 *   PUT /month-wrap-up/dismiss       { month: "2026-10" }: closed, not shown again
 * Money in euros.
 */

const express = require("express");
const { buildMonthWrapUp, findWrapUpToShow, listMonthsWithWrapUps, monthAsNumber } = require("../services/monthWrapUp.js");
const { saveSettings, readSetting } = require("../services/appSettings.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

const router = express.Router();
const isYearMonth = (text) => typeof text === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
const toEuros = convertCentsToEuros;

const wrapUpToApi = (wrapUp) => wrapUp && {
  ...wrapUp,
  income: toEuros(wrapUp.income), expenses: toEuros(wrapUp.expenses), saved: toEuros(wrapUp.saved),
  expenses_before: toEuros(wrapUp.expenses_before),
  top_categories: wrapUp.top_categories.map((row) => ({ ...row, amount: toEuros(row.amount), amount_before: toEuros(row.amount_before) })),
  biggest_expense: wrapUp.biggest_expense && { ...wrapUp.biggest_expense, amount: toEuros(wrapUp.biggest_expense.amount) },
  budgets: wrapUp.budgets && { ...wrapUp.budgets, over: wrapUp.budgets.over.map((row) => ({ ...row, budget: toEuros(row.budget), actual: toEuros(row.actual) })) },
  goals: wrapUp.goals.map((goal) => ({ ...goal, saved: toEuros(goal.saved) })),
};

router.get("/month-wrap-up", function getMonthWrapUp(request, response) {
  const today = getTodayAsLocalDate();
  const month = request.query.month;
  if (month === undefined) return response.json({ wrap_up: wrapUpToApi(findWrapUpToShow(today)) });
  if (!isYearMonth(month) || month >= today.slice(0, 7)) return response.status(400).json({ error: "month must be a past month, as YYYY-MM" });
  response.json({ wrap_up: wrapUpToApi(buildMonthWrapUp(month, today)) });
});

router.get("/month-wrap-up/months", function listWrapUpMonths(request, response) {
  response.json(listMonthsWithWrapUps(getTodayAsLocalDate()));
});

router.put("/month-wrap-up/dismiss", function dismissMonthWrapUp(request, response) {
  const month = request.body?.month;
  if (!isYearMonth(month)) return response.status(400).json({ error: "month must be YYYY-MM" });
  // never moves back: closing an older one again doesn't bring a newer one back
  const dismissed = Math.max(readSetting("month_wrap_up_dismissed"), monthAsNumber(month));
  const { error } = saveSettings({ month_wrap_up_dismissed: dismissed });
  if (error) return response.status(400).json({ error });
  response.json({ dismissed_through: month });
});

module.exports = router;
