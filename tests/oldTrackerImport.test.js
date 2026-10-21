/* IMPORT FROM THE OLD TRACKER (services/oldTrackerCsv.js, services/oldTrackerImport.js, routes/oldTrackerImportRoutes.js)
 * A small old tracker of its own, so every number can be worked out by hand:
 *
 *   start of 2026: cash 2.000 €, the car (Polo) 1.000 €, 2 SWDA shares
 *   January    coffee 2,50 (filed under Food), pizza 40, salary 1.000, trousers 30 (filed under Products),
 *              fuel 10 (filed under Food); 100 € into SWDA on the 2nd (1 share: 3 in total)
 *   February   a bike 500 (Products), a "Ricalcolo" −20; 500 € into the car on the 10th (Polo: 1.500)
 *
 *   netto starts on 1 March: Bank 2.500 €, Polo 1.500 €, SWDA opening position 3 shares for 290 €
 *
 *   "Old tracker": 2.000 + 1.000 − 582,50 spent − 20 recount − 100 SWDA − 500 car = 1.797,50 on 28 Feb;
 *   Bank started with 2.500: +702,50 recount on 1 March, then 2.500 handed over to Bank → 0, closed.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { parseOldTrackerCsv } = require("../backend/server/services/oldTrackerCsv.js");
const { rebuildHoldingFromTrades } = require("../backend/server/services/holdingsCalculator.js");

const db = openTestDatabase();
let callApi, stopServer;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const ids = {};

const months = (values) => `${values};;;;;;;;;;;;`.split(";").slice(0, 13).join(";");
const CSV = [
  "2026: Tabella 1",
  "Asset/Liability;2025;Jan;Feb;Mar;Apr;May;Jun;Jul;Aug;Sep;Oct;Nov;Dec;2026;AVG",
  `Material goods;1.000,00;${months("1.000,00;1.500,00;1.500,00")}`,
  `Polo;1.000,00;${months("1.000,00;1.500,00;1.500,00")}`,
  `Cash - Liquidity;2.000,00;${months("2.827,50;1.797,50")}`,
  "",
  "INV: Tabella 1",
  ";2025;Jan;Feb;Mar;Apr;May;Jun;Jul;Aug;Sep;Oct;Nov;Dec;2026",
  "FUNDS;;;;",
  "SWDA.MI;100;101;102;103;;;;;;;;;;",
  "APP;90;93,33;93,33;93,33;;;;;;;;;;",
  "N. Pos;2;3;3;3;3;3;3;3;3;3;3;3;3;3",
  "",
  "JAN: Table 1",
  "Date;€;Cat;;Motive;Income;Balance;;",
  "3;2,50;Food;;Caffè;;Grocery;0,00;",
  "5;40;Food;;Pizza;;Food;52,50;",
  "10;1000;Income;;Stipendio;Job;Products;30,00;",
  "12;30;Product;;Pantaloni;;Income;1000,00;",
  "20;10;Food;;Benzina;;TOT SPE MEN;82,50;",
  "",
  "JAN: ASSETS CHANGE",
  "Date;€;From;To;Motive",
  "2;100;Cash;MSCI WORLD;",
  "",
  "FEB: Table 1",
  "Date;€;Cat;;Motive;Income;Balance;;",
  "4;500;Product;;Bici;;Products;500,00;",
  "6;20;Necessity;;Ricalcolo;;Necessities;20,00;",
  ";;;;;;TOT SPE MEN;520,00;",
  "",
  "FEB: ASSETS CHANGE",
  "Date;€;From;To;Motive",
  "10;500;Cash;Car;",
].join("\n");

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  ids.bank = (await call("POST", "/accounts", { name: "Bank", kind: "bank", opening_balance: 2500 })).id;
  ids.polo = (await call("POST", "/accounts", { name: "Polo", kind: "asset", opening_balance: 1500 })).id;
  db.prepare(`UPDATE accounts SET open_date = '2026-03-01'`).run();
  ids.food = (await call("POST", "/categories", { name: "Food", kind: "expense" })).id;
  db.prepare(`INSERT INTO investment_trades (ticker, side, date, shares, amount, fees, account_id, transaction_id, note)
    VALUES ('SWDA.MI', 'buy', '2026-03-01', 3, 29000, 0, NULL, NULL, 'Opening position (bought before trades were recorded)')`).run();
  rebuildHoldingFromTrades("SWDA.MI");
  await call("POST", "/transactions", { type: "expense", amount: 12, from_account_id: ids.bank, category_id: ids.food, date: "2026-03-02" });
});
after(() => stopServer());

test("the file is read sheet by sheet, and every month is checked against its own totals", async () => {
  const parsed = parseOldTrackerCsv(CSV);
  assert.equal(parsed.year, 2026);
  assert.equal(parsed.summary.cashAtStartOfYear, 200000);
  assert.deepEqual(parsed.months.map((month) => [month.month, month.transactions.length]), [["JAN", 5], ["FEB", 2]]);
  assert.deepEqual(parsed.assetChanges.map((change) => [change.date, change.amount, change.to]), [["2026-01-02", 10000, "MSCI WORLD"], ["2026-02-10", 50000, "Car"]]);

  const plan = await call("POST", "/import/old-tracker/preview", { csv: CSV });
  assert.ok(plan.total_checks.every((check) => check.differences.length === 0));
  assert.equal((await callApi("POST", "/import/old-tracker/preview", { csv: "hello;world" })).status, 400);
});

test("the preview: corrections, recounts, new categories, the car and the ETF, nothing saved", async () => {
  const plan = await call("POST", "/import/old-tracker/preview", { csv: CSV });
  const line = (description) => plan.lines.find((candidate) => candidate.description === description);
  assert.equal(line("Caffè").category, "Coffee");
  assert.equal(line("Benzina").category, "Transport");
  assert.equal(line("Pantaloni").category, "Clothes");
  assert.equal(line("Pizza").category, "Food");
  assert.deepEqual([line("Ricalcolo").type, line("Ricalcolo").direction], ["adjustment", "out"]);
  assert.equal(line("Stipendio").category, "Salary - Office");
  assert.deepEqual(plan.new_categories.map((category) => category.name).sort(), ["Clothes", "Coffee", "Products", "Salary - Office", "Transport"]);

  const history = plan.history_account;
  assert.equal(history.before_hand_over, 2000 + 1000 - 582.5 - 20 - 100 - 500);
  assert.equal(history.difference, 2500 - 1797.5);
  assert.deepEqual(history.hand_overs.map((handOver) => [handOver.name, handOver.amount]), [["Bank", 2500]]);
  assert.equal(plan.car.applies, true);
  const swda = plan.investments.find((investment) => investment.ticker === "SWDA.MI");
  assert.deepEqual([swda.applies, swda.openingShares, swda.openingAmount, swda.purchases[0].shares], [true, 2, 190, 1]);

  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get().n, 2, "a preview saves nothing");
});

test("importing: the history is in, today's balances, shares and cost are exactly as before", async () => {
  const balancesBefore = db.prepare(`SELECT name, balance FROM accounts ORDER BY id`).all();
  const holdingBefore = db.prepare(`SELECT shares, amount_invested FROM investments WHERE ticker = 'SWDA.MI'`).get();

  await call("POST", "/import/old-tracker", { csv: CSV });

  assert.deepEqual(db.prepare(`SELECT name, balance FROM accounts WHERE name <> 'Old tracker' ORDER BY id`).all(), balancesBefore);
  assert.deepEqual(db.prepare(`SELECT shares, amount_invested FROM investments WHERE ticker = 'SWDA.MI'`).get(), holdingBefore);
  const history = db.prepare(`SELECT * FROM accounts WHERE name = 'Old tracker'`).get();
  assert.deepEqual([history.balance, history.opening_balance, history.open_date, history.closed_at], [0, 200000, "2026-01-01", "2026-03-01"]);
  const bank = db.prepare(`SELECT opening_balance FROM accounts WHERE id = ?`).get(ids.bank);
  assert.equal(bank.opening_balance, 0, "Bank now receives its opening balance from the old tracker");
  const polo = db.prepare(`SELECT opening_balance, open_date FROM accounts WHERE id = ?`).get(ids.polo);
  assert.deepEqual([polo.opening_balance, polo.open_date], [100000, "2026-01-01"]);
  assert.deepEqual(db.prepare(`SELECT date, shares, amount FROM investment_trades WHERE ticker = 'SWDA.MI' ORDER BY date`).all(),
    [{ date: "2026-01-01", shares: 2, amount: 19000 }, { date: "2026-01-02", shares: 1, amount: 10000 }]);

  // the statements of January – March add up, and see the old spending
  const statements = await call("GET", "/statements?from=2026-01-01&to=2026-03-31");
  assert.equal(statements.bridge.unexplained, 0);
  assert.equal(statements.income_statement.total_expenses, 582.5 + 12);
  assert.equal(statements.income_statement.expenses.find((category) => category.name === "Coffee").total, 2.5);

  // once is enough
  const again = await callApi("POST", "/import/old-tracker", { csv: CSV });
  assert.equal(again.status, 409);
});
