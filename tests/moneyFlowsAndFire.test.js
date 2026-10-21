/* MONEY FLOWS (the Sankey on Statements, services/sankeyFlows.js) and the FIRE NUMBER (Forecast, services/fireNumber.js)
 * The flows must always add up to the income statement of the same period, both sides to the same total.
 * The FIRE maths is checked with round numbers, then through GET /forecast with its settings.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { buildSankeyFlows } = require("../backend/server/services/sankeyFlows.js");
const { calculateFireNumber, findWhenFireNumberIsReached } = require("../backend/server/services/fireNumber.js");
const { buildFinancialStatements } = require("../backend/server/services/financialStatements.js");
const { addDays } = require("../backend/server/services/netWorthHistory.js");
const { getTodayAsLocalDate } = require("../backend/server/utils/localDates.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const toCents = (euros) => Math.round(euros * 100);
const sumOf = (boxes) => boxes.reduce((sum, box) => sum + box.amount, 0);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

// ---------- the flows, on their own ----------

const row = (name, total, categoryId = name) => ({ category_id: categoryId, name, total });

test("earning more than spending: the rest goes into investments and savings, both sides add up", () => {
  const flows = buildSankeyFlows({ incomeRows: [row("Salary", 300000)], expenseRows: [row("Rent", 120000), row("Food", 80000)], investmentCash: -50000 });
  assert.deepEqual(flows.sources.map((box) => [box.label, box.amount]), [["Salary", 300000]]);
  assert.deepEqual(flows.uses.map((box) => [box.label, box.amount]), [["Rent", 120000], ["Food", 80000], ["Into investments", 50000], ["Left as savings", 50000]]);
  assert.equal(sumOf(flows.sources), sumOf(flows.uses));
  assert.equal(flows.total, 300000);
});

test("spending more than you earn (the master's): the gap is 'taken from savings' on the left", () => {
  const flows = buildSankeyFlows({ incomeRows: [row("Scholarship", 30000)], expenseRows: [row("Rent", 70000), row("Food", 70000)], investmentCash: 0 });
  assert.deepEqual(flows.sources.map((box) => [box.label, box.amount]), [["Scholarship", 30000], ["Taken from savings", 110000]]);
  assert.ok(!flows.uses.some((box) => box.kind === "savings"));
  assert.equal(sumOf(flows.sources), 140000);
  assert.equal(sumOf(flows.uses), 140000);
  assert.equal(flows.savings, -110000);
});

test("selling investments to pay for things: the sales are a source, and the totals still match", () => {
  const flows = buildSankeyFlows({ incomeRows: [row("Salary", 100000)], expenseRows: [row("Car repair", 120000)], investmentCash: 50000 });
  assert.deepEqual(flows.sources.map((box) => box.label), ["Salary", "Investments sold"]);
  assert.deepEqual(flows.uses.map((box) => [box.label, box.amount]), [["Car repair", 120000], ["Left as savings", 30000]]);
  assert.equal(sumOf(flows.sources), sumOf(flows.uses));
});

test("small categories (under 3%) are grouped into 'Other' only when there are two or more; the totals don't change", () => {
  const expenses = [row("Rent", 70000), row("Food", 25000), row("Stamps", 900), row("Apps", 1200), row("Gum", 300)];
  const flows = buildSankeyFlows({ incomeRows: [row("Salary", 97400)], expenseRows: expenses, investmentCash: 0 });
  const other = flows.uses.find((box) => box.key === "expense-other");
  assert.equal(other.label, "Other expenses (3 categories)");
  assert.equal(other.amount, 2400);
  assert.deepEqual(other.grouped.map((item) => item.name), ["Stamps", "Apps", "Gum"]);
  assert.equal(sumOf(flows.uses.filter((box) => box.kind === "expense")), 97400);

  const oneSmall = buildSankeyFlows({ incomeRows: [row("Salary", 100000)], expenseRows: [row("Rent", 70000), row("Gum", 300)], investmentCash: 0 });
  assert.ok(oneSmall.uses.some((box) => box.label === "Gum"), "a single small category stays itself");
});

// ---------- the flows, through the statements ----------

function assertFlowsMatchTheIncomeStatement(statements, period) {
  const { money_flows: flows, income_statement: incomeStatement } = statements;
  const centsOf = (boxes) => boxes.reduce((sum, box) => sum + toCents(box.amount), 0);
  assert.equal(centsOf(flows.sources), centsOf(flows.uses), `${period}: left = right`);
  assert.equal(centsOf(flows.sources), toCents(flows.total), `${period}: total`);
  assert.equal(centsOf(flows.sources.filter((box) => box.kind === "income")), toCents(incomeStatement.total_income), `${period}: income boxes = total income`);
  assert.equal(centsOf(flows.uses.filter((box) => box.kind === "expense")), toCents(incomeStatement.total_expenses), `${period}: expense boxes = total expenses`);
  assert.equal(toCents(incomeStatement.total_income) - toCents(incomeStatement.total_expenses) - toCents(flows.into_investments), toCents(flows.savings), `${period}: savings`);
  for (const box of [...flows.sources, ...flows.uses]) assert.ok(box.amount > 0, `${period}: ${box.label} is positive`);
}

test("for fixed and random periods, the flows add up to the income statement exactly", async () => {
  const fixedPeriods = [["2025-01-01", "2025-01-31"], ["2025-02-01", "2025-12-31"], ["2026-01-01", "2026-03-31"], ["2025-09-10", "2025-09-14"], ["2026-03-02", "2026-03-02"]];
  for (const [from, to] of fixedPeriods) assertFlowsMatchTheIncomeStatement(await buildFinancialStatements(from, to), `${from}…${to}`);

  let state = 20261015; // a fixed seed: the same "random" periods every run
  const nextRandom = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  const today = getTodayAsLocalDate();
  for (let attempt = 0; attempt < 25; attempt++) {
    const from = addDays("2025-01-01", Math.floor(nextRandom() * 600));
    const to = addDays(from, Math.floor(nextRandom() * 300));
    if (to > today) continue;
    assertFlowsMatchTheIncomeStatement(await buildFinancialStatements(from, to), `${from}…${to}`);
  }
  const { money_flows: march } = await call("GET", "/statements?from=2026-03-01&to=2026-03-31");
  assert.ok(march.sources.some((box) => box.label === "Investments sold"), "the VWCE sale of 2 March paid into Savings");
});

// ---------- FIRE ----------

test("FIRE number = yearly expenses ÷ withdrawal rate, reached when cash + investments in today's euros get there", () => {
  assert.equal(calculateFireNumber(3000000, 0.035), 85714286); // 30.000 € a year at 3.5% -> 857.142,86 €
  assert.equal(calculateFireNumber(3000000, 0.04), 75000000);
  assert.equal(calculateFireNumber(0, 0.035), null);

  const points = [
    { date: "2030-01-14", cash: 10000000, investments: 60000000, deflator: 1.0 },
    { date: "2030-02-14", cash: 10000000, investments: 66000000, deflator: 1.1 },  // 76.000 nominal = 69.090 today: not yet
    { date: "2030-03-14", cash: 10000000, investments: 73000000, deflator: 1.1 },  // 83.000 nominal = 75.454 today: reached
  ];
  assert.equal(findWhenFireNumberIsReached(points, 75000000).date, "2030-03-14");
  assert.equal(findWhenFireNumberIsReached(points, 90000000), null);
  assert.equal(findWhenFireNumberIsReached(points, null), null);
});

test("GET /forecast has the FIRE number: from the plan's last phase or the last 12 months, the car never counted", async () => {
  await call("PUT", "/forecast/assumptions", { yearly_return: 0.05, yearly_inflation: 0.02, savings_go_to: "investments", yearly_depreciation: 0.15 });
  await call("POST", "/forecast/phases", { name: "Master's", from_month: getTodayAsLocalDate().slice(0, 7), monthly_income: 300, monthly_expenses: 1400 });
  await call("POST", "/forecast/phases", { name: "Working", from_month: "2028-10", monthly_income: 2600, monthly_expenses: 1750 });

  const { fire } = await call("GET", "/forecast?years=10");
  assert.equal(fire.expenses_from, "last_phase");
  assert.equal(fire.last_phase.name, "Working");
  assert.equal(fire.yearly_expenses, 21000);
  assert.equal(fire.withdrawal_rate, 0.035);
  assert.equal(fire.fire_number, 600000);  // 21.000 / 3.5%
  const { net_worth: netWorth } = await call("GET", "/net-worth");
  const carValue = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(dataset.accountIds.car).balance / 100;
  assert.ok(Math.abs(fire.counted_now - (netWorth - carValue)) < 0.02, "cash + investments, without the car");
  assert.ok(Math.abs(fire.share_now - fire.counted_now / 600000) < 1e-9);
  assert.equal(fire.reached_on, null, "not within 10 years on these numbers");

  await call("PUT", "/settings", { fire_withdrawal_rate: 0.04, fire_expenses_from_last_12_months: 1 });
  const lastTwelve = (await call("GET", "/forecast?years=10")).fire;
  assert.equal(lastTwelve.expenses_from, "last_12_months");
  assert.equal(lastTwelve.last_12_months.months_of_data, 12);
  assert.equal(lastTwelve.yearly_expenses, lastTwelve.last_12_months.yearly_expenses);
  assert.equal(toCents(lastTwelve.fire_number), Math.round(toCents(lastTwelve.yearly_expenses) / 0.04));
  assert.equal((await callApi("PUT", "/settings", { fire_withdrawal_rate: 0.1 })).status, 400);

  // a plan that does get there: a big income and small expenses in the last phase, at the highest rate allowed (6%)
  await call("PUT", "/settings", { fire_withdrawal_rate: 0.06, fire_expenses_from_last_12_months: 0 });
  const working = (await call("GET", "/forecast")).phases.find((candidate) => candidate.name === "Working");
  await call("PUT", `/forecast/phases/${working.id}`, { name: "Working", from_month: "2027-01", monthly_income: 9000, monthly_expenses: 500 });
  const reached = (await call("GET", "/forecast?years=10")).fire;
  assert.equal(reached.fire_number, 100000); // 6.000 € a year / 6%
  assert.ok(reached.reached_on, "reached within 10 years");
  const forecastPoint = (await call("GET", "/forecast?years=10")).forecast.find((point) => point.date === reached.reached_on);
  assert.ok((forecastPoint.cash + forecastPoint.investments) / forecastPoint.deflator >= 100000);
});
