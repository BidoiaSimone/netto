/* TRANSACTIONS SENT LATER BY THE PHONE (migration 18, POST /transactions with offline_id)
 * The phone may send the same one twice (it didn't hear back the first time): it must be added once.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");

const db = openTestDatabase();
let callApi, stopServer, accountId;
before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  accountId = (await callApi("POST", "/accounts", { name: "Cash", kind: "cash", opening_balance: 100 })).body.id;
});
after(() => stopServer());

const balance = () => db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(accountId).balance;

test("the same offline_id twice adds one transaction, and the balance moves once", async () => {
  const coffee = { type: "expense", amount: 1.2, from_account_id: accountId, date: "2026-10-10", offline_id: "phone-1-abc" };
  const first = await callApi("POST", "/transactions", coffee);
  assert.equal(first.status, 201);
  const second = await callApi("POST", "/transactions", coffee);
  assert.equal(second.status, 200);
  assert.equal(second.body.already_received, true);
  assert.equal(second.body.id, first.body.id);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get().n, 1);
  assert.equal(balance(), 10000 - 120);

  // deleted afterwards: a late copy still adds nothing
  await callApi("DELETE", `/transactions/${first.body.id}`);
  const late = await callApi("POST", "/transactions", coffee);
  assert.equal(late.status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get().n, 0);
});

test("a refused transaction doesn't use up its offline_id; a bad offline_id is refused", async () => {
  const broken = { type: "expense", amount: -5, from_account_id: accountId, offline_id: "phone-2" };
  assert.equal((await callApi("POST", "/transactions", broken)).status, 400);
  assert.equal((await callApi("POST", "/transactions", { ...broken, amount: 5 })).status, 201, "fixed and sent again: added");
  assert.equal((await callApi("POST", "/transactions", { ...broken, amount: 5, offline_id: 42 })).status, 400);
  assert.equal((await callApi("POST", "/transactions", { ...broken, amount: 5, offline_id: "x".repeat(65) })).status, 400);
});
