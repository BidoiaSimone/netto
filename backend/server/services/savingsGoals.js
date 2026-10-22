/* GOALS PAID FOR BY CUTTING BACK (Goals page; tables: migration 17)
 *
 * A goal is something you'd buy anyway ("MacBook, 1.300 €"), paid for by spending less in some categories.
 * Each of its categories has a baseline, what it normally costs you a month, fixed when the goal is created.
 *
 *   saved in a month = baseline − what you really spent in that category
 *
 * summed over the goal's categories. A month where you spend more than the baseline counts against the goal:
 * the bar can go down. The first and the current month count only their days from the start (or up to today):
 * on the 10th of a 30-day month, a 90 € baseline is 30 € so far.
 *
 * THE QUEUE: goals are filled in order (position 1 first). Two goals can share a category (both funded by
 * Coffee): each month, a category's savings go to the first goal in the queue that uses it and is still
 * collecting. A goal stops collecting once it's full (from the month after). Then the category's savings go
 * to the next goal that uses it. Whatever a goal collects
 * above its target in its last month is passed on to the next goal in the queue that's collecting, so a
 * euro you saved is never lost (if no goal is collecting, it stays with the full one, above 100%).
 * In the month a goal is filled or bought, its categories stay with it for the whole month.
 *
 * THE PURCHASE: when you buy the thing, you link its transaction to the goal. Then:
 *   - bought before the goal was full, it's "paying back": it keeps collecting after the purchase, until it
 *     reaches its target. Buy first, cut back after: the bar shows how much of it you've earned back.
 *   - once full (before or after the purchase) it's "bought", and shows how much of the price your cutting
 *     back paid for
 *   - the purchase's amount becomes the target: the goal collects the real price, not the one you planned.
 *     The planned target is kept (planned_target), and comes back if the purchase is unlinked.
 *   - that transaction never counts as spending in any goal's categories (a MacBook filed under Products
 *     must not wipe out the savings of a goal funded by Products)
 * Nothing else changes: on Insights and Statements the purchase is an ordinary expense. Over the months
 * you were saving, you spent what you would have spent anyway: that's the point.
 *
 * LINKED INCOME (migration 22): an income can be linked to a goal (selling the old MacBook pays for part of the
 * new one). Its whole amount goes to that goal in the month it came in, on top of what cutting back saved,
 * whether or not the goal is collecting from its categories that month. If that takes the goal above its target,
 * the extra is passed on like any other (above). Income that isn't linked never counts toward a goal, and a
 * linked one is still an ordinary income everywhere else (Insights, Statements, the forecast).
 * The pace ("about 60 € a month") is the cutting back only: a one-off sale says nothing about the months ahead.
 *
 * Money is in cents here; the routes convert to euros.
 */

const db = require("../../db/databaseConnection.js");
const { findFirstRecordedDate } = require("../../db/firstRecordedDate.js");

const MONTHS_FOR_BASELINE = 6;
const AVERAGE_DAYS_IN_MONTH = 365.25 / 12;
const DAYS_BEFORE_THE_PACE_MEANS_SOMETHING = 7;

// ---------- dates ----------

const padTwoDigits = (number) => String(number).padStart(2, "0");
const countDaysInMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const nextMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${padTwoDigits(month + 1)}`;
};
const previousMonth = (yearMonth) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${padTwoDigits(month - 1)}`;
};
// Days from first to last, both included ("2026-10-05", "2026-10-16" -> 12)
const countDaysBetween = (firstDay, lastDay) => Math.round((Date.parse(lastDay) - Date.parse(firstDay)) / 864e5) + 1;
const laterOf = (first, second) => (first > second ? first : second);
const earlierOf = (first, second) => (first < second ? first : second);

// ---------- reading the goals ----------

function loadGoals() {
  const goals = db.prepare(`
    SELECT g.id, g.name, g.target, g.start_date, g.position, g.purchase_transaction_id, g.created_at,
           t.date AS purchase_date, t.amount AS purchase_amount, t.description AS purchase_description
    FROM savings_goals g LEFT JOIN transactions t ON t.id = g.purchase_transaction_id
    ORDER BY g.position, g.id
  `).all();
  const categoriesOfGoal = db.prepare(`
    SELECT gc.category_id, c.name, gc.monthly_baseline
    FROM savings_goal_categories gc JOIN categories c ON c.id = gc.category_id
    WHERE gc.goal_id = ? ORDER BY c.name COLLATE NOCASE
  `);
  for (const goal of goals) {
    goal.categories = categoriesOfGoal.all(goal.id);
    goal.planned_target = goal.target;
    if (goal.purchase_amount !== null) goal.target = goal.purchase_amount; // bought: the real price is what it collects
  }
  return goals;
}

// Spending in one category between two days, leaving out every goal's purchase (cents)
const selectSpentInCategory = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
  WHERE type = 'expense' AND category_id = ? AND date BETWEEN ? AND ?
    AND id NOT IN (SELECT purchase_transaction_id FROM savings_goals WHERE purchase_transaction_id IS NOT NULL)
`);
const sumSpentInCategory = (categoryId, firstDay, lastDay) => selectSpentInCategory.get(categoryId, firstDay, lastDay).total;

// Every income linked to a goal (cents), oldest first
const selectLinkedIncomes = db.prepare(`
  SELECT gi.goal_id, t.id AS transaction_id, t.date, t.amount, t.description, c.name AS category
  FROM savings_goal_incomes gi JOIN transactions t ON t.id = gi.transaction_id
  LEFT JOIN categories c ON c.id = t.category_id
  ORDER BY t.date, t.id
`);

// ---------- the maths ----------

// The days of `yearMonth` a goal counts: from its start (or the 1st) to today (or the month's end). The
// purchase doesn't end it: a goal bought before it was full goes on collecting, paying the purchase back.
// Null when it counts none.
function findCountedDays(goal, yearMonth, today) {
  const firstDay = laterOf(`${yearMonth}-01`, goal.start_date);
  const lastDay = earlierOf(`${yearMonth}-${padTwoDigits(countDaysInMonth(yearMonth))}`, today);
  return firstDay <= lastDay ? { firstDay, lastDay } : null;
}

// Every goal with what it has saved, month by month. today: YYYY-MM-DD (a parameter so the tests can choose it).
function calculateGoalProgress(today) {
  const goals = loadGoals();
  const state = new Map(goals.map((goal) => [goal.id, {
    saved: 0, savedByCuttingBack: 0, daysCounted: 0, months: [], incomes: [],
    savedByCategory: new Map(goal.categories.map((category) => [category.category_id, 0])),
  }]));
  const linkedIncomes = selectLinkedIncomes.all().filter((income) => income.date <= today);
  for (const income of linkedIncomes) state.get(income.goal_id).incomes.push(income);

  const startedGoals = goals.filter((goal) => goal.start_date <= today);
  const firstMonths = [...startedGoals.map((goal) => goal.start_date.slice(0, 7)), ...linkedIncomes.map((income) => income.date.slice(0, 7))];
  if (firstMonths.length) {
    const firstMonth = firstMonths.sort()[0];
    const currentMonth = today.slice(0, 7);
    for (let month = firstMonth; month <= currentMonth; month = nextMonth(month)) {
      const isFullAtMonthStart = new Map(goals.map((goal) => [goal.id, state.get(goal.id).saved >= goal.target]));
      const isCollecting = (goal) => !isFullAtMonthStart.get(goal.id) && findCountedDays(goal, month, today) !== null;
      const monthRowOf = new Map(); // goal id -> this month's row

      // each category goes to the first goal in the queue that uses it and is collecting
      const categoryTaken = new Set();
      for (const goal of goals) {
        if (!isCollecting(goal)) continue;
        const days = findCountedDays(goal, month, today);
        const share = countDaysBetween(days.firstDay, days.lastDay) / countDaysInMonth(month);
        for (const category of goal.categories) {
          if (categoryTaken.has(category.category_id)) continue;
          categoryTaken.add(category.category_id);
          const baseline = Math.round(category.monthly_baseline * share);
          const spent = sumSpentInCategory(category.category_id, days.firstDay, days.lastDay);
          const row = monthRowOf.get(goal.id) ?? newMonthRow(month, share < 1);
          row.baseline += baseline;
          row.spent += spent;
          row.saved += baseline - spent;
          monthRowOf.set(goal.id, row);
          const goalState = state.get(goal.id);
          goalState.saved += baseline - spent;
          goalState.savedByCuttingBack += baseline - spent;
          goalState.savedByCategory.set(category.category_id, goalState.savedByCategory.get(category.category_id) + baseline - spent);
        }
        if (monthRowOf.has(goal.id)) state.get(goal.id).daysCounted += countDaysBetween(days.firstDay, days.lastDay);
      }

      // the income linked to a goal goes to it, collecting or not (a full one passes it on just below)
      for (const income of linkedIncomes) {
        if (income.date.slice(0, 7) !== month) continue;
        const row = monthRowOf.get(income.goal_id) ?? newMonthRow(month, false);
        row.income += income.amount;
        monthRowOf.set(income.goal_id, row);
        state.get(income.goal_id).saved += income.amount;
      }

      // what a goal collected above its target goes on to the next goal in the queue that's collecting
      for (const [index, goal] of goals.entries()) {
        const goalState = state.get(goal.id);
        const extra = goalState.saved - goal.target;
        if (extra <= 0 || !monthRowOf.has(goal.id)) continue;
        const nextGoal = goals.slice(index + 1).find((candidate) => isCollecting(candidate) && state.get(candidate.id).saved < candidate.target);
        if (!nextGoal) continue;
        goalState.saved -= extra;
        monthRowOf.get(goal.id).carried_in -= extra;
        state.get(nextGoal.id).saved += extra;
        const nextRow = monthRowOf.get(nextGoal.id) ?? newMonthRow(month, false);
        nextRow.carried_in += extra;
        monthRowOf.set(nextGoal.id, nextRow);
      }

      for (const [goalId, row] of monthRowOf) state.get(goalId).months.push(row);
    }
  }

  return goals.map((goal) => describeGoal(goal, state.get(goal.id), today));
}

// One row of a goal's "Month by month": saved = baseline − spent (cutting back); income = what linked income
// brought; carried_in = what came from (+) or went to (−) other goals in the queue
const newMonthRow = (month, partial) => ({ month, baseline: 0, spent: 0, saved: 0, income: 0, carried_in: 0, partial });

// One goal as the page needs it (cents)
function describeGoal(goal, goalState, today) {
  const isBought = goal.purchase_transaction_id !== null;
  const isFull = goalState.saved >= goal.target;
  const status = isBought ? (isFull ? "bought" : "paying_back")
    : isFull ? "reached"
    : goal.start_date > today ? "not_started"
    : goalState.months.length ? "saving"
    : "waiting"; // its categories are all taken by goals before it in the queue

  // At the pace so far, when would it be full? Only once there are enough days to say something.
  let monthlyPace = null, monthsToGo = null;
  if ((status === "saving" || status === "paying_back") && goalState.daysCounted >= DAYS_BEFORE_THE_PACE_MEANS_SOMETHING) {
    monthlyPace = Math.round((goalState.savedByCuttingBack / goalState.daysCounted) * AVERAGE_DAYS_IN_MONTH);
    if (monthlyPace > 0) monthsToGo = (goal.target - goalState.saved) / monthlyPace;
  }

  const incomeTotal = goalState.incomes.reduce((sum, income) => sum + income.amount, 0);
  const shareOfPurchase = (amount) => Math.max(0, Math.min(1, amount / goal.purchase_amount));
  return {
    id: goal.id,
    name: goal.name,
    target: goal.target,                 // the purchase's amount once it's linked
    planned_target: goal.planned_target, // what you set
    start_date: goal.start_date,
    position: goal.position,
    status,
    saved: goalState.saved,
    share: goalState.saved / goal.target,
    income_total: incomeTotal,     // what the linked income brought (some of it may have been passed on to the next goal)
    incomes: goalState.incomes.map(({ goal_id, ...income }) => income), // oldest first
    monthly_pace: monthlyPace,     // cents a month at the pace so far (null: too early to tell, or not saving)
    months_to_go: monthsToGo,      // null when there's no positive pace
    categories: goal.categories.map((category) => ({
      category_id: category.category_id, name: category.name, monthly_baseline: category.monthly_baseline,
      saved: goalState.savedByCategory.get(category.category_id),
    })),
    months: goalState.months.slice().reverse(), // newest first
    purchase: isBought ? {
      transaction_id: goal.purchase_transaction_id, date: goal.purchase_date, amount: goal.purchase_amount, description: goal.purchase_description,
      share_paid_by_income: shareOfPurchase(incomeTotal),
      share_paid_by_saving: Math.min(shareOfPurchase(goalState.saved - incomeTotal), 1 - shareOfPurchase(incomeTotal)), // the cutting back
    } : null,
  };
}

// ---------- the suggested baselines ----------

// What each expense category usually costs a month (cents), to fill in a new goal's baselines.
//
// "Usually" means while you weren't trying to spend less: a month in which a goal was cutting back on a
// category says little about what that
// category normally costs, and averaging it in would make every new goal stricter than the last. So,
// category by category:
//   1. the average of the last complete months (up to 6, only months your records cover from the 1st),
//      leaving out that category's goal months (from a goal's start to its purchase, or to now while it's
//      still collecting or paying back);
//   2. no such month, and the category is (or was) in a goal: that goal's baseline, which was fixed before
//      the cutting back started (the latest goal's, if there are several);
//   3. otherwise (no complete month recorded yet): the spending since your first record, scaled to a month.
// Goal purchases are never counted as spending.
function suggestBaselines(today) {
  const currentMonth = today.slice(0, 7);
  const firstRecordedDay = findFirstRecordedDate(db);
  const recordedMonths = [];
  for (let month = previousMonth(currentMonth); recordedMonths.length < 36 && `${month}-01` >= firstRecordedDay; month = previousMonth(month)) {
    recordedMonths.push(month); // newest first
  }

  // a goal's months end with its purchase once it's fully paid ("bought"); paying back, it's still cutting back
  const statusOf = new Map(calculateGoalProgress(today).map((goal) => [goal.id, goal.status]));
  const goalUses = db.prepare(`
    SELECT gc.category_id, gc.monthly_baseline, g.id AS goal_id, g.name AS goal_name, g.start_date, t.date AS purchase_date
    FROM savings_goal_categories gc JOIN savings_goals g ON g.id = gc.goal_id
    LEFT JOIN transactions t ON t.id = g.purchase_transaction_id
    ORDER BY g.start_date DESC, g.id DESC
  `).all();
  const isGoalMonth = (categoryId, month) => goalUses.some((use) => use.category_id === categoryId
    && use.start_date.slice(0, 7) <= month
    && (statusOf.get(use.goal_id) !== "bought" || use.purchase_date.slice(0, 7) >= month));

  // with no complete month at all: the days recorded so far, scaled to a month
  const partialFirstDay = laterOf(firstRecordedDay, `${currentMonth}-01`);
  const partialMonths = countDaysBetween(partialFirstDay, today) / AVERAGE_DAYS_IN_MONTH;

  const categories = db.prepare(`SELECT id, name FROM categories WHERE kind = 'expense' ORDER BY name COLLATE NOCASE`).all();
  return {
    complete_months: recordedMonths.length > MONTHS_FOR_BASELINE ? MONTHS_FOR_BASELINE : recordedMonths.length,
    categories: categories.map((category) => {
      const cleanMonths = recordedMonths.filter((month) => !isGoalMonth(category.id, month)).slice(0, MONTHS_FOR_BASELINE);
      const skippedGoalMonths = recordedMonths.slice(0, MONTHS_FOR_BASELINE).filter((month) => isGoalMonth(category.id, month)).length;
      const answer = { category_id: category.id, name: category.name, skipped_goal_months: skippedGoalMonths };
      if (cleanMonths.length) {
        const total = cleanMonths.reduce((sum, month) =>
          sum + sumSpentInCategory(category.id, `${month}-01`, `${month}-${padTwoDigits(countDaysInMonth(month))}`), 0);
        return { ...answer, monthly_average: Math.round(total / cleanMonths.length), based_on: "months", months: cleanMonths.length };
      }
      const latestGoalUse = goalUses.find((use) => use.category_id === category.id);
      if (latestGoalUse) return { ...answer, monthly_average: latestGoalUse.monthly_baseline, based_on: "goal", goal_name: latestGoalUse.goal_name };
      return { ...answer, monthly_average: Math.round(sumSpentInCategory(category.id, partialFirstDay, today) / partialMonths),
        based_on: "days", days: countDaysBetween(partialFirstDay, today) };
    }),
  };
}

module.exports = { calculateGoalProgress, suggestBaselines };
