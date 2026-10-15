/* CHECKS THE FORECAST PLAN SENT BY THE FRONTEND: phases, one-off events, assumptions (migration 12) */

const db = require("../../db/databaseConnection.js");
const { convertEurosToCents } = require("../utils/moneyConversion.js");

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const cleanName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");

// The ranges the sliders allow, and the only ones accepted: anything outside is a typo, not a plan
const ASSUMPTION_LIMITS = {
  yearly_return: { lowest: -0.2, highest: 0.3, label: "the yearly return" },
  yearly_inflation: { lowest: -0.05, highest: 0.2, label: "inflation" },
  yearly_depreciation: { lowest: 0, highest: 0.9, label: "the yearly depreciation" },
};

// { name, from_month, monthly_income, monthly_expenses } -> { phase } (cents) or { error }
function validatePhase(requestBody = {}) {
  const name = cleanName(requestBody.name);
  if (!name) return { error: "a phase needs a name (e.g. Master's)" };
  if (!MONTH_PATTERN.test(requestBody.from_month ?? "")) return { error: "from_month must be YYYY-MM" };
  const monthlyIncome = requestBody.monthly_income === "" || requestBody.monthly_income == null ? 0 : convertEurosToCents(requestBody.monthly_income);
  const monthlyExpenses = requestBody.monthly_expenses === "" || requestBody.monthly_expenses == null ? 0 : convertEurosToCents(requestBody.monthly_expenses);
  if (!(monthlyIncome >= 0) || !(monthlyExpenses >= 0)) return { error: "monthly income and expenses must be 0 or more" };
  return { phase: { name, fromMonth: requestBody.from_month, monthlyIncome, monthlyExpenses } };
}

// { name, month, amount (+ in / − out), sells_account_id? } -> { event } (cents) or { error }
function validateEvent(requestBody = {}) {
  const name = cleanName(requestBody.name);
  if (!name) return { error: "an event needs a name (e.g. Sell the Polo)" };
  if (!MONTH_PATTERN.test(requestBody.month ?? "")) return { error: "month must be YYYY-MM" };
  const amount = convertEurosToCents(requestBody.amount);
  if (!Number.isFinite(amount) || amount === 0) return { error: "the amount must be a number other than 0 (+ money in, − money out)" };
  let sellsAccountId = null;
  if (requestBody.sells_account_id !== undefined && requestBody.sells_account_id !== null && requestBody.sells_account_id !== "") {
    sellsAccountId = Number(requestBody.sells_account_id);
    const account = db.prepare(`SELECT name, kind FROM accounts WHERE id = ?`).get(sellsAccountId);
    if (!account) return { error: `Unknown account id: ${requestBody.sells_account_id}` };
    if (account.kind !== "asset") return { error: `${account.name} isn't a personal-use asset: only those can be sold in the forecast` };
  }
  return { event: { name, month: requestBody.month, amount, sellsAccountId } };
}

// Only the fields sent are changed: { yearly_return?, yearly_inflation?, savings_go_to?, yearly_depreciation? }
// -> { changes } (column -> value) or { error }
function validateAssumptions(requestBody = {}) {
  const changes = {};
  for (const [field, limits] of Object.entries(ASSUMPTION_LIMITS)) {
    if (requestBody[field] === undefined) continue;
    const value = Number(requestBody[field]);
    if (!Number.isFinite(value) || value < limits.lowest || value > limits.highest) {
      return { error: `${limits.label} must be between ${limits.lowest * 100}% and ${limits.highest * 100}%` };
    }
    changes[field] = value;
  }
  if (requestBody.savings_go_to !== undefined) {
    if (!["cash", "investments"].includes(requestBody.savings_go_to)) return { error: "savings_go_to must be cash or investments" };
    changes.savings_go_to = requestBody.savings_go_to;
  }
  return { changes };
}

module.exports = { validatePhase, validateEvent, validateAssumptions };
