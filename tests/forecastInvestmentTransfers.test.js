/* FORECAST EVENTS THAT MOVE MONEY WITH INVESTMENTS (migration 13)
 * Investing 5,000 € isn't spending it: the money only changes place. An event linked to investments must
 * leave the net worth unchanged that month, move exactly its amount between cash and investments, and let the
 * invested money grow from then on. Selling can't take out more than there is. Old events keep their meaning.
 */

const { openTestDatabase, TEMPORARY_BACKUPS_DIRECTORY } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { simulateForecast } = require("../backend/server/services/forecastSimulation.js");
const { allMigrationsInOrder } = require("../backend/db/migrations/allMigrationsInOrder.js");
const { runPendingMigrations, LATEST_DATABASE_VERSION } = require("../backend/db/migrations/migrationRunner.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

// Money in cents. 35,000 € cash, 9,000 € invested, nothing else, unless a test says otherwise.
const NO_ASSUMPTIONS = { yearlyReturn: 0, yearlyInflation: 0, savingsGoTo: "cash", yearlyDepreciation: 0 };
const simulate = (overrides) => simulateForecast({
  startDate: "2026-10-15", months: 36,
  start: { cash: 3500000, investments: 900000, personalUseAssets: [] }, phases: [], events: [], assumptions: NO_ASSUMPTIONS,
  ...overrides,
});
const investFiveThousandInNovember = { name: "Invest", month: "2026-11", amount: -500000, sellsAccountId: null, transfersWithInvestments: true };

// ---------- the maths ----------

test("−5,000 linked to investments: cash −5,000, investments +5,000, net worth unchanged", () => {
  const { points } = simulate({ events: [investFiveThousandInNovember] });
  assert.equal(points[1].month, "2026-11");
  assert.deepEqual([points[1].cash, points[1].investments, points[1].netWorth], [3000000, 1400000, 4400000]);
  assert.equal(points[1].netWorth, points[0].netWorth);

  // the same −5,000 as a plain event: spent, so the net worth drops by 5,000 (what the forecast did before)
  const spent = simulate({ events: [{ ...investFiveThousandInNovember, transfersWithInvestments: false }] });
  assert.deepEqual([spent.points[1].cash, spent.points[1].investments, spent.points[1].netWorth], [3000000, 900000, 3900000]);
});

test("the invested money grows from the next month: a year later it's worth 5,000 × 1.06 at 6%", () => {
  const withReturn = { ...NO_ASSUMPTIONS, yearlyReturn: 0.06 };
  const invested = simulate({ assumptions: withReturn, events: [investFiveThousandInNovember] });
  const notInvested = simulate({ assumptions: withReturn });
  // step 1 is November (bought after that month's growth); step 13 is November a year later: 12 growths
  const extraValue = invested.points[13].investments - notInvested.points[13].investments;
  assert.ok(Math.abs(extraValue - 500000 * 1.06) <= 1, `expected 530,000 cents, got ${extraValue}`);
  assert.equal(invested.points[13].cash, notInvested.points[13].cash - 500000);
});

test("+ linked to investments sells them, but never more than there is", () => {
  const { points } = simulate({
    start: { cash: 100000, investments: 200000, personalUseAssets: [] },
    events: [{ name: "Sell ETFs", month: "2027-03", amount: 300000, sellsAccountId: null, transfersWithInvestments: true }],
  });
  const saleStep = points.findIndex((point) => point.month === "2027-03");
  assert.deepEqual([points[saleStep].cash, points[saleStep].investments], [300000, 0], "only the 2,000 € that exist are sold");
  assert.equal(points[saleStep].netWorth, points[saleStep - 1].netWorth);
});

test("the lowest cash point is the same either way: investing still takes the cash", () => {
  const phases = [{ name: "Master's", fromMonth: "2026-10", monthlyIncome: 80000, monthlyExpenses: 100000 }];
  const invested = simulate({ phases, events: [investFiveThousandInNovember] });
  const spent = simulate({ phases, events: [{ ...investFiveThousandInNovember, transfersWithInvestments: false }] });
  assert.deepEqual(invested.lowestCash, spent.lowestCash);
  assert.equal(invested.points[36].netWorth - spent.points[36].netWorth, 500000);
});

// ---------- API, backups, migration ----------

test("API: an event can be linked to investments, switched back, and can't also sell the car", async () => {
  let forecast = await call("POST", "/forecast/events", { name: "Invest", month: "2027-01", amount: -5000, transfers_with_investments: true });
  const saved = forecast.events.find((event) => event.name === "Invest");
  assert.deepEqual([saved.amount, saved.transfers_with_investments, saved.sells_account_id], [-5000, true, null]);
  assert.equal(db.prepare(`SELECT transfers_with_investments FROM forecast_events WHERE id = ?`).get(saved.id).transfers_with_investments, 1);

  forecast = await call("PUT", `/forecast/events/${saved.id}`, { name: "Invest", month: "2027-01", amount: -5000, transfers_with_investments: false });
  assert.equal(forecast.events.find((event) => event.id === saved.id).transfers_with_investments, false);

  const both = await callApi("POST", "/forecast/events", { name: "Both", month: "2027-02", amount: 6000, sells_account_id: dataset.accountIds.car, transfers_with_investments: true });
  assert.equal(both.status, 400);
  await call("DELETE", `/forecast/events/${saved.id}`);
});

test("JSON backups keep the link; a version 12 backup's events import as plain money in or out", async () => {
  await call("POST", "/forecast/events", { name: "Invest", month: "2027-01", amount: -5000, transfers_with_investments: true });
  const exported = await call("GET", "/export");
  assert.equal(exported.forecast_events.find((event) => event.name === "Invest").transfers_with_investments, 1);

  await call("POST", "/import", exported);
  assert.equal(db.prepare(`SELECT transfers_with_investments FROM forecast_events WHERE name = 'Invest'`).get().transfers_with_investments, 1);

  const versionTwelveEvents = exported.forecast_events.map(({ transfers_with_investments, ...event }) => event);
  await call("POST", "/import", { ...exported, format_version: 12, forecast_events: versionTwelveEvents });
  assert.equal(db.prepare(`SELECT transfers_with_investments FROM forecast_events WHERE name = 'Invest'`).get().transfers_with_investments, 0);
});

test("migration 13: events saved before it keep meaning money in or out", () => {
  // a database as it was yesterday: migrations 1 to 12 applied the way the runner applies them (foreign keys
  // off while tables are rebuilt), then switched on as the app runs
  const oldDatabase = new Database(":memory:");
  oldDatabase.pragma("foreign_keys = OFF"); // better-sqlite3 switches them on by default
  allMigrationsInOrder.slice(0, 12).forEach((migrate) => migrate(oldDatabase));
  oldDatabase.pragma("user_version = 12");
  oldDatabase.pragma("foreign_keys = ON");
  oldDatabase.prepare(`INSERT INTO forecast_events (name, month, amount) VALUES ('Investment allocation', '2026-11', -500000)`).run();

  const originalLog = console.log;
  console.log = () => {}; // the runner announces each migration
  try { runPendingMigrations(oldDatabase, { backupDirectory: TEMPORARY_BACKUPS_DIRECTORY }); } finally { console.log = originalLog; }

  assert.equal(oldDatabase.pragma("user_version", { simple: true }), LATEST_DATABASE_VERSION);
  assert.deepEqual(oldDatabase.prepare(`SELECT name, amount, transfers_with_investments FROM forecast_events`).all(),
    [{ name: "Investment allocation", amount: -500000, transfers_with_investments: 0 }]);
  assert.throws(() => oldDatabase.prepare(`UPDATE forecast_events SET transfers_with_investments = 2`).run(), /CHECK/);
  oldDatabase.close();
});
