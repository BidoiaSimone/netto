/* RECONCILIATION REMINDERS: which accounts are due to be counted again (Next up, Home).
 * The fake dataset creates its accounts through the API, which marks them reconciled today; the tests set
 * last_reconciled by hand and pass their own "today", so the answers never depend on the date the tests run.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { listAccountsToReconcile } = require("../backend/server/services/reconciliationReminders.js");
const { readAllSettings } = require("../backend/server/services/appSettings.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const setLastReconciled = (accountId, date) => db.prepare(`UPDATE accounts SET last_reconciled = ? WHERE id = ?`).run(date, accountId);
const TODAY = "2026-10-15";

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
  const { cash, currentAccount, savings, mealVouchers, car, oldCard } = dataset.accountIds;
  setLastReconciled(cash, "2026-09-01");         // 44 days: due (every 28)
  setLastReconciled(currentAccount, null);       // never: due, first of all
  setLastReconciled(savings, "2026-08-01");      // 75 days: not yet (every 91)
  setLastReconciled(mealVouchers, "2026-09-17"); // exactly 28 days: due today
  setLastReconciled(car, null);                  // a personal-use asset: never reminded
  setLastReconciled(oldCard, "2025-01-01");      // closed: never reminded
});
after(() => stopServer());

test("everyday accounts every 28 days, savings every 91, never the car or a closed account", () => {
  const due = listAccountsToReconcile({ today: TODAY });
  assert.deepEqual(due.map((account) => account.name), ["Current account", "Cash", "Meal vouchers"]);
  const cash = due.find((account) => account.name === "Cash");
  assert.deepEqual({ days_since: cash.days_since, every_days: cash.every_days, overdue_days: cash.overdue_days }, { days_since: 44, every_days: 28, overdue_days: 16 });
  assert.equal(due.find((account) => account.name === "Meal vouchers").overdue_days, 0);
  assert.equal(due[0].days_since, null, "never reconciled");
});

test("the intervals are settings, and 0 turns a group's reminders off", () => {
  const settings = readAllSettings();
  const everydayOff = listAccountsToReconcile({ today: TODAY, settings: { ...settings, reconcile_every_days_everyday: 0, reconcile_every_days_savings: 30 } });
  assert.deepEqual(everydayOff.map((account) => account.name), ["Savings"]);
  assert.equal(everydayOff[0].overdue_days, 45);
  const generous = listAccountsToReconcile({ today: TODAY, settings: { ...settings, reconcile_every_days_everyday: 60 } });
  assert.deepEqual(generous.map((account) => account.name), ["Current account"]);
});

test("reconciling an account takes it off the list; the API answers with today's reminders", async () => {
  const { cash } = dataset.accountIds;
  const cashBalance = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(cash).balance;
  await call("POST", `/accounts/${cash}/reconcile`, { counted: cashBalance / 100 }); // counted exactly what was recorded
  const reminders = await call("GET", "/reconciliation-reminders");
  assert.ok(!reminders.some((account) => account.name === "Cash"));
  assert.ok(reminders.some((account) => account.name === "Current account"));

  await call("PUT", "/settings", { reconcile_every_days_everyday: 0, reconcile_every_days_savings: 0 });
  assert.deepEqual(await call("GET", "/reconciliation-reminders"), []);
  assert.equal((await callApi("PUT", "/settings", { reconcile_every_days_savings: 12.5 })).status, 400, "whole days only");
});
