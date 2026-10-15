/* VALIDATION (backend/server/validation/)
 * What the API must refuse, and how it turns euros into cents.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { convertEurosToCents } = require("../backend/server/utils/moneyConversion.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

// ---------- categories must match the transaction type ----------

test("an income can't use an expense category", async () => {
  const response = await callApi("POST", "/transactions", { type: "income", amount: 10, to_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.groceries });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Groceries is an expense category/);
});

test("an expense can't use an income category", async () => {
  const response = await callApi("POST", "/transactions", { type: "expense", amount: 10, from_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.salary });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Salary is an income category/);
});

test("editing an expense into an income keeps the rule: its expense category is refused", async () => {
  const { id } = await call("POST", "/transactions", { type: "expense", amount: 10, from_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.groceries });
  const response = await callApi("PUT", `/transactions/${id}`, { type: "income", amount: 10, to_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.groceries });
  assert.equal(response.status, 400);
});

test("a recurring rule follows the same category rule", async () => {
  const response = await callApi("POST", "/recurring-transactions", {
    type: "income", amount: 10, to_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.rent,
    repeat_unit: "month", start_date: "2030-01-01",
  });
  assert.equal(response.status, 400);
});

test("movements may use a category of either kind", async () => {
  for (const categoryId of [dataset.categoryIds.salary, dataset.categoryIds.rent]) {
    const response = await callApi("POST", "/transactions", { type: "movement", amount: 1, from_account_id: dataset.accountIds.cash, to_account_id: dataset.accountIds.savings, category_id: categoryId });
    assert.equal(response.status, 201);
  }
});

// ---------- closed accounts ----------

test("a closed account can't be picked for a new transaction, rule, trade or reconciliation", async () => {
  const { oldCard } = dataset.accountIds;
  const refusals = [
    await callApi("POST", "/transactions", { type: "income", amount: 5, to_account_id: oldCard, category_id: dataset.categoryIds.refund }),
    await callApi("POST", "/transactions", { type: "movement", amount: 5, from_account_id: dataset.accountIds.cash, to_account_id: oldCard }),
    await callApi("POST", "/recurring-transactions", { type: "expense", amount: 5, from_account_id: oldCard, repeat_unit: "month", start_date: "2030-01-01" }),
    await callApi("POST", "/investments/trades", { ticker: "AAPL", side: "buy", shares: 1, price: 10, account_id: oldCard }),
    await callApi("POST", `/accounts/${oldCard}/reconcile`, { counted: 0 }),
  ];
  for (const refusal of refusals) {
    assert.equal(refusal.status, 400);
    assert.match(refusal.body.error, /Old card is closed/);
  }
});

test("an old transaction on a closed account can still be edited", async () => {
  const oldTransaction = db.prepare(`SELECT id, amount, date FROM transactions WHERE to_account_id = ? AND type = 'income'`).get(dataset.accountIds.oldCard);
  const response = await callApi("PUT", `/transactions/${oldTransaction.id}`, {
    type: "income", amount: oldTransaction.amount / 100, to_account_id: dataset.accountIds.oldCard,
    category_id: dataset.categoryIds.refund, date: oldTransaction.date, description: "Cashback",
  });
  assert.equal(response.status, 200);
});

test("an account can only be closed at a zero balance", async () => {
  const response = await callApi("POST", `/accounts/${dataset.accountIds.savings}/close`);
  assert.equal(response.status, 400);
  assert.match(response.body.error, /still holds/);
});

// ---------- amounts in cents ----------

test("euros become cents rounded the way people expect, without float noise", () => {
  const expectedCentsByEuros = [
    [1.005, 101], ["1.005", 101], [2.675, 268], [0.1 + 0.2, 30], [19.99, 1999], [1.1 * 3, 330],
    [87.3 + 3 * 3.17, 9681], [1234567.89, 123456789], [0.01, 1], [0.004, 0], [-12.34, -1234], ["12", 1200],
  ];
  for (const [euros, cents] of expectedCentsByEuros) assert.equal(convertEurosToCents(euros), cents, `${euros} €`);
  for (const notANumber of ["", null, undefined, "abc", Infinity, "1,50"]) assert.ok(Number.isNaN(convertEurosToCents(notANumber)), `${notANumber}`);
});

test("an amount of 1.005 € is stored as 101 cents and read back as 1.01 €", async () => {
  const { id } = await call("POST", "/transactions", { type: "expense", amount: 1.005, from_account_id: dataset.accountIds.cash, category_id: dataset.categoryIds.groceries });
  assert.equal(db.prepare(`SELECT amount FROM transactions WHERE id = ?`).get(id).amount, 101);
  const listed = (await call("GET", "/transactions")).find((transaction) => transaction.id === id);
  assert.equal(listed.amount, 1.01);
});

test("amounts that round to less than a cent, and zero or negative ones, are refused", async () => {
  for (const amount of [0, 0.004, -5, "abc", ""]) {
    const response = await callApi("POST", "/transactions", { type: "expense", amount, from_account_id: dataset.accountIds.cash });
    assert.equal(response.status, 400, `amount ${JSON.stringify(amount)}`);
  }
});

// ---------- other refusals ----------

test("dates in the future, impossible dates, a movement to the same account and unknown ids are refused", async () => {
  const { cash } = dataset.accountIds;
  const refusedTransactions = [
    { type: "expense", amount: 1, from_account_id: cash, date: "2999-01-01" },
    { type: "expense", amount: 1, from_account_id: cash, date: "2026-02-30" },
    { type: "movement", amount: 1, from_account_id: cash, to_account_id: cash },
    { type: "expense", amount: 1, from_account_id: 9999 },
    { type: "expense", amount: 1, from_account_id: cash, category_id: 9999 },
    { type: "expense", amount: 1 },
    { type: "adjustment", amount: 1, to_account_id: cash },
  ];
  for (const transaction of refusedTransactions) {
    const response = await callApi("POST", "/transactions", transaction);
    assert.equal(response.status, 400, JSON.stringify(transaction));
  }
});

test("a sell of more shares than held at that date is refused and changes nothing", async () => {
  const tradesBefore = db.prepare(`SELECT COUNT(*) AS n FROM investment_trades`).get().n;
  const balanceBefore = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(dataset.accountIds.currentAccount).balance;
  const response = await callApi("POST", "/investments/trades", { ticker: "VWCE.MI", side: "sell", shares: 50, price: 100, date: "2026-05-01", account_id: dataset.accountIds.currentAccount });
  assert.equal(response.status, 400);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM investment_trades`).get().n, tradesBefore);
  assert.equal(db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(dataset.accountIds.currentAccount).balance, balanceBefore);
});

test("a ticker the market data doesn't know is refused", async () => {
  const response = await callApi("POST", "/investments/trades", { ticker: "NOPE.XX", side: "buy", shares: 1, price: 10 });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Couldn't find a price for NOPE.XX/);
});
