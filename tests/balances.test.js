/* BALANCES
 * The stored balance of every account is kept by database triggers (migration 3). Whatever happens to
 * the transactions (added, edited, deleted, reconciled, posted by a recurring rule, created by a trade)
 * every balance must still equal opening balance + money in − money out. After each step below, both
 * checks in helpers/balanceRule.js must find nothing.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { listAllBalanceProblems } = require("./helpers/balanceRule.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

const storedBalance = (accountId) => db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(accountId).balance;
const assertEveryBalanceIsRight = (afterWhat) => assert.deepEqual(listAllBalanceProblems(db), [], `balances wrong after ${afterWhat}`);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

test("the fake dataset itself has every balance right", () => {
  assertEveryBalanceIsRight("building the dataset");
  assert.equal(storedBalance(dataset.accountIds.oldCard), 0);
});

test("income: add, edit amount and account, change to an expense, delete", async () => {
  const { currentAccount, savings } = dataset.accountIds;
  const { salary, groceries } = dataset.categoryIds;
  const currentBefore = storedBalance(currentAccount), savingsBefore = storedBalance(savings);

  const { id } = await call("POST", "/transactions", { type: "income", amount: 99.99, to_account_id: currentAccount, category_id: salary, date: "2026-02-01" });
  assert.equal(storedBalance(currentAccount), currentBefore + 9999);
  assertEveryBalanceIsRight("adding an income");

  await call("PUT", `/transactions/${id}`, { type: "income", amount: 120.01, to_account_id: savings, category_id: salary, date: "2026-02-01" });
  assert.equal(storedBalance(currentAccount), currentBefore);
  assert.equal(storedBalance(savings), savingsBefore + 12001);
  assertEveryBalanceIsRight("moving an income to another account with a new amount");

  await call("PUT", `/transactions/${id}`, { type: "expense", amount: 10, from_account_id: savings, category_id: groceries, date: "2026-02-01" });
  assert.equal(storedBalance(savings), savingsBefore - 1000);
  assertEveryBalanceIsRight("turning the income into an expense");

  await call("DELETE", `/transactions/${id}`);
  assert.equal(storedBalance(savings), savingsBefore);
  assertEveryBalanceIsRight("deleting it");
});

test("expense: add, edit, delete", async () => {
  const { cash, mealVouchers } = dataset.accountIds;
  const cashBefore = storedBalance(cash);
  const { id } = await call("POST", "/transactions", { type: "expense", amount: 7.5, from_account_id: cash, category_id: dataset.categoryIds.groceries });
  assert.equal(storedBalance(cash), cashBefore - 750);
  await call("PUT", `/transactions/${id}`, { type: "expense", amount: 12.3, from_account_id: mealVouchers, category_id: dataset.categoryIds.groceries });
  assert.equal(storedBalance(cash), cashBefore);
  assertEveryBalanceIsRight("editing an expense");
  await call("DELETE", `/transactions/${id}`);
  assertEveryBalanceIsRight("deleting an expense");
});

test("movement: add, swap its accounts, delete; the total of all accounts never changes", async () => {
  const { currentAccount, savings } = dataset.accountIds;
  const totalOfAllAccounts = () => db.prepare(`SELECT SUM(balance) AS total FROM accounts`).get().total;
  const totalBefore = totalOfAllAccounts();

  const { id } = await call("POST", "/transactions", { type: "movement", amount: 250, from_account_id: currentAccount, to_account_id: savings });
  assert.equal(totalOfAllAccounts(), totalBefore);
  await call("PUT", `/transactions/${id}`, { type: "movement", amount: 250, from_account_id: savings, to_account_id: currentAccount });
  assert.equal(totalOfAllAccounts(), totalBefore);
  assertEveryBalanceIsRight("swapping a movement's accounts");
  await call("DELETE", `/transactions/${id}`);
  assert.equal(totalOfAllAccounts(), totalBefore);
  assertEveryBalanceIsRight("deleting a movement");
});

test("reconciliation: counting more, then less, editing its details, deleting it", async () => {
  const { savings } = dataset.accountIds;
  const recorded = storedBalance(savings);

  const up = await call("POST", `/accounts/${savings}/reconcile`, { counted: (recorded + 1234) / 100 });
  assert.equal(up.difference, 12.34);
  assert.equal(storedBalance(savings), recorded + 1234);
  assertEveryBalanceIsRight("reconciling up");

  const down = await call("POST", `/accounts/${savings}/reconcile`, { counted: (recorded - 500) / 100 });
  assert.equal(down.difference, -17.34);
  assert.equal(storedBalance(savings), recorded - 500);
  assertEveryBalanceIsRight("reconciling down");

  // only date, category and description of an adjustment can change: an amount sent along is ignored
  const adjustment = db.prepare(`SELECT id, amount FROM transactions WHERE type = 'adjustment' AND from_account_id = ? ORDER BY id DESC`).get(savings);
  await call("PUT", `/transactions/${adjustment.id}`, { amount: 999, description: "Counted at the bank", date: "2026-01-31" });
  assert.equal(db.prepare(`SELECT amount FROM transactions WHERE id = ?`).get(adjustment.id).amount, adjustment.amount);
  assert.equal(storedBalance(savings), recorded - 500);
  assertEveryBalanceIsRight("editing a reconciliation's details");

  await call("DELETE", `/transactions/${adjustment.id}`);
  assert.equal(storedBalance(savings), recorded + 1234);
  assertEveryBalanceIsRight("deleting a reconciliation");

  // counting exactly what is recorded adds no transaction
  const countBefore = db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get().n;
  await call("POST", `/accounts/${savings}/reconcile`, { counted: storedBalance(savings) / 100 });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get().n, countBefore);
});

test("changing an account's opening balance moves its balance by the same amount", async () => {
  const { car } = dataset.accountIds;
  const before = storedBalance(car);
  await call("PUT", `/accounts/${car}`, { name: "Car", kind: "asset", opening_balance: 11000.55 });
  assert.equal(storedBalance(car), before - 99945);
  assertEveryBalanceIsRight("changing an opening balance");
});

test("trades: their cash transactions keep the balances right when added, edited and deleted", async () => {
  const { currentAccount, savings } = dataset.accountIds;
  const currentBefore = storedBalance(currentAccount), savingsBefore = storedBalance(savings);

  const { id } = await call("POST", "/investments/trades", { ticker: "AAPL", side: "buy", shares: 2, price: 150, fees: 1, date: "2026-04-01", account_id: currentAccount });
  assert.equal(storedBalance(currentAccount), currentBefore - 30100);
  assertEveryBalanceIsRight("a buy paid from an account");

  await call("PUT", `/investments/trades/${id}`, { ticker: "AAPL", side: "buy", shares: 2, price: 150, fees: 1, date: "2026-04-01", account_id: savings });
  assert.equal(storedBalance(currentAccount), currentBefore);
  assert.equal(storedBalance(savings), savingsBefore - 30100);
  assertEveryBalanceIsRight("moving a buy to another account");

  await call("PUT", `/investments/trades/${id}`, { ticker: "AAPL", side: "buy", shares: 2, price: 150, fees: 1, date: "2026-04-01", account_id: "" });
  assert.equal(storedBalance(savings), savingsBefore);
  assertEveryBalanceIsRight("a buy no longer paid from any account");

  await call("PUT", `/investments/trades/${id}`, { ticker: "AAPL", side: "buy", shares: 2, price: 150, fees: 1, date: "2026-04-01", account_id: currentAccount });
  await call("DELETE", `/investments/trades/${id}`);
  assert.equal(storedBalance(currentAccount), currentBefore);
  assertEveryBalanceIsRight("deleting a trade");
});

test("the cash side of a trade can't be edited or deleted as a plain transaction", async () => {
  const investmentTransaction = db.prepare(`SELECT id FROM transactions WHERE type = 'investment' LIMIT 1`).get();
  const edit = await callApi("PUT", `/transactions/${investmentTransaction.id}`, { type: "expense", amount: 1, from_account_id: dataset.accountIds.cash });
  assert.equal(edit.status, 400);
  const deletion = await callApi("DELETE", `/transactions/${investmentTransaction.id}`);
  assert.equal(deletion.status, 400);
  assertEveryBalanceIsRight("refused changes");
});

test("a recurring rule's posted transactions, and deleting the rule, keep the balances right", async () => {
  const { savings } = dataset.accountIds;
  const savingsBefore = storedBalance(savings);
  const { id, added } = await call("POST", "/recurring-transactions", {
    type: "income", amount: 5, to_account_id: savings, category_id: dataset.categoryIds.refund,
    repeat_unit: "week", repeat_interval: 2, start_date: "2026-01-05", end_date: "2026-03-30",
  });
  assert.equal(added, 7); // 5 Jan, 19 Jan, 2 Feb, 16 Feb, 2 Mar, 16 Mar, 30 Mar
  assert.equal(storedBalance(savings), savingsBefore + 7 * 500);
  assertEveryBalanceIsRight("posting a recurring rule");

  await call("DELETE", `/recurring-transactions/${id}`);
  assert.equal(storedBalance(savings), savingsBefore + 7 * 500, "the transactions it added stay");
  assertEveryBalanceIsRight("deleting the rule");
});
