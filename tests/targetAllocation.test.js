/* TARGET ALLOCATION (migration 15): drift from the targets, and splitting new money without selling.
 * The maths (services/targetAllocation.js) is tested on its own with round numbers, then through the API on the
 * fake dataset (VWCE.MI 11 shares at 123,45 € and AAPL 2 shares at 201,37 €).
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { describeAllocation, splitNewMoneyWithoutSelling } = require("../backend/server/services/targetAllocation.js");

const db = openTestDatabase();
let callApi, stopServer;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  await buildFakeDataset(callApi, db);
});
after(() => stopServer());

// ---------- the maths ----------

const euros = (amount) => Math.round(amount * 100); // the functions work in cents
const targets = (entries) => new Map(Object.entries(entries).map(([ticker, percent]) => [ticker, percent * 100]));
const buysInEuros = (split) => Object.fromEntries(split.map((buy) => [buy.ticker, buy.amountInCents / 100]));
const PORTFOLIO_TARGETS = targets({ "SWDA.MI": 70, "EIMI.MI": 15, "VWCE.MI": 15 });

test("already balanced: new money follows the targets exactly", () => {
  const holdings = [{ ticker: "SWDA.MI", valueInCents: euros(7000) }, { ticker: "EIMI.MI", valueInCents: euros(1500) }, { ticker: "VWCE.MI", valueInCents: euros(1500) }];
  assert.deepEqual(buysInEuros(splitNewMoneyWithoutSelling(holdings, PORTFOLIO_TARGETS, euros(1000))), { "SWDA.MI": 700, "EIMI.MI": 150, "VWCE.MI": 150 });
  for (const row of describeAllocation(holdings, PORTFOLIO_TARGETS)) {
    assert.ok(Math.abs(row.driftPoints) < 1e-9);
    assert.equal(row.driftInCents, 0);
  }
});

test("one ticker far off: all the money goes to it until it catches up, then the rest follows the targets", () => {
  const holdings = [{ ticker: "SWDA.MI", valueInCents: euros(7000) }, { ticker: "EIMI.MI", valueInCents: euros(1500) }]; // VWCE.MI: nothing yet
  const rows = describeAllocation(holdings, PORTFOLIO_TARGETS);
  const vwce = rows.find((row) => row.ticker === "VWCE.MI");
  assert.equal(vwce.valueInCents, 0);
  assert.equal(Math.round(vwce.driftPoints * 100) / 100, -15);
  assert.equal(vwce.driftInCents, -euros(1275)); // 15% of 8.500 €

  // 1.000 € isn't enough to fill VWCE: it gets everything
  assert.deepEqual(buysInEuros(splitNewMoneyWithoutSelling(holdings, PORTFOLIO_TARGETS, euros(1000))), { "VWCE.MI": 1000, "SWDA.MI": 0, "EIMI.MI": 0 });

  // 5.000 €: 1.500 € bring VWCE level with the others, the other 3.500 € split 70 / 15 / 15
  const split = splitNewMoneyWithoutSelling(holdings, PORTFOLIO_TARGETS, euros(5000));
  assert.deepEqual(buysInEuros(split), { "SWDA.MI": 2450, "VWCE.MI": 2025, "EIMI.MI": 525 });
  const after = holdings.map((holding) => ({ ...holding, valueInCents: holding.valueInCents + split.find((buy) => buy.ticker === holding.ticker).amountInCents }));
  after.push({ ticker: "VWCE.MI", valueInCents: split.find((buy) => buy.ticker === "VWCE.MI").amountInCents });
  for (const row of describeAllocation(after, PORTFOLIO_TARGETS)) assert.ok(Math.abs(row.driftPoints) < 1e-9, `${row.ticker} on target`);
});

test("too little money to fix everything: the most underweight (relative to its target) gets it, nobody sells", () => {
  // SWDA 6.000 (target 70%: fullness 8.571), EIMI 900 (15%: 6.000), VWCE 1.200 (15%: 8.000)
  const holdings = [{ ticker: "SWDA.MI", valueInCents: euros(6000) }, { ticker: "EIMI.MI", valueInCents: euros(900) }, { ticker: "VWCE.MI", valueInCents: euros(1200) }];
  assert.deepEqual(buysInEuros(splitNewMoneyWithoutSelling(holdings, PORTFOLIO_TARGETS, euros(200))), { "EIMI.MI": 200, "SWDA.MI": 0, "VWCE.MI": 0 });
  // 400 €: 300 € bring EIMI to VWCE's level (1.200 = 15% × 8.000), the next 100 € are shared by the two equally
  // (they'd need 171 € more to reach SWDA's level, so SWDA still gets nothing)
  assert.deepEqual(buysInEuros(splitNewMoneyWithoutSelling(holdings, PORTFOLIO_TARGETS, euros(400))), { "EIMI.MI": 350, "VWCE.MI": 50, "SWDA.MI": 0 });
  const split = splitNewMoneyWithoutSelling(holdings, PORTFOLIO_TARGETS, euros(123.45));
  assert.ok(split.every((buy) => buy.amountInCents >= 0), "never a sale");
  assert.equal(split.reduce((sum, buy) => sum + buy.amountInCents, 0), euros(123.45));
});

test("a ticker with no target counts as 0%: it is pure drift and never gets new money", () => {
  const holdings = [
    { ticker: "SWDA.MI", valueInCents: euros(7000) }, { ticker: "EIMI.MI", valueInCents: euros(1500) }, { ticker: "VWCE.MI", valueInCents: euros(1500) },
    { ticker: "AAPL", valueInCents: euros(2500) },
  ];
  const aapl = describeAllocation(holdings, PORTFOLIO_TARGETS).find((row) => row.ticker === "AAPL");
  assert.equal(aapl.targetShare, 0);
  assert.equal(aapl.currentShare, 0.2);
  assert.equal(Math.round(aapl.driftPoints * 100) / 100, 20);
  assert.equal(aapl.driftInCents, euros(2500));
  const split = buysInEuros(splitNewMoneyWithoutSelling(holdings, PORTFOLIO_TARGETS, euros(1000)));
  assert.deepEqual(split, { "SWDA.MI": 700, "EIMI.MI": 150, "VWCE.MI": 150 });
  assert.ok(!("AAPL" in split));
});

test("the buys always add up to the cent, and no targets means no split", () => {
  const thirds = targets({ A: 33.33, B: 33.33, C: 33.34 });
  for (const money of [1, 2, 100, 101, 99999, 123457]) {
    const split = splitNewMoneyWithoutSelling([], thirds, money);
    assert.equal(split.reduce((sum, buy) => sum + buy.amountInCents, 0), money, `${money} cents`);
  }
  assert.deepEqual(splitNewMoneyWithoutSelling([{ ticker: "A", valueInCents: 100 }], new Map(), euros(500)), []);
});

// ---------- through the API ----------

test("targets must add up to exactly 100%, once per ticker, and be tickers that exist", async () => {
  const refusedBecause = async (targetList, pattern) => {
    const { status, body } = await callApi("PUT", "/investments/targets", { targets: targetList });
    assert.equal(status, 400, JSON.stringify(targetList));
    assert.match(body.error, pattern);
  };
  await refusedBecause([{ ticker: "VWCE.MI", target_percent: 60 }, { ticker: "AAPL", target_percent: 30 }], /add up to 90%/);
  await refusedBecause([{ ticker: "VWCE.MI", target_percent: 50 }, { ticker: "vwce.mi", target_percent: 50 }], /twice/);
  await refusedBecause([{ ticker: "VWCE.MI", target_percent: 50 }, { ticker: "NOPE.MI", target_percent: 50 }], /Couldn't find a price for NOPE.MI/);
  await refusedBecause([{ ticker: "VWCE.MI", target_percent: 120 }], /between 0 and 100%/);
  const saved = await call("PUT", "/investments/targets", { targets: [{ ticker: "aapl", target_percent: 33.33 }, { ticker: "VWCE.MI", target_percent: 66.67 }] });
  assert.deepEqual(saved, [{ ticker: "VWCE.MI", target_percent: 66.67 }, { ticker: "AAPL", target_percent: 33.33 }]);
  assert.deepEqual(db.prepare(`SELECT * FROM investment_targets ORDER BY ticker`).all(), [{ ticker: "AAPL", target_basis_points: 3333 }, { ticker: "VWCE.MI", target_basis_points: 6667 }]);
});

test("GET /investments/allocation: shares, drift and a split of new money at live prices", async () => {
  await call("PUT", "/investments/targets", { targets: [{ ticker: "VWCE.MI", target_percent: 60 }, { ticker: "AAPL", target_percent: 40 }] });
  const allocation = await call("GET", "/investments/allocation?new_money=500");
  const vwceValue = 11 * 123.45, aaplValue = 2 * 201.37, total = vwceValue + aaplValue;
  assert.equal(allocation.total_value, Math.round(total * 100) / 100);
  assert.deepEqual(allocation.missing_prices, []);
  assert.equal(allocation.drift_threshold_points, 5);
  const vwce = allocation.rows.find((row) => row.ticker === "VWCE.MI");
  assert.equal(Math.round(vwce.current_share * 10000) / 10000, Math.round((vwceValue / total) * 10000) / 10000);
  assert.equal(vwce.target_share, 0.6);
  assert.equal(Math.round(vwce.drift_points * 100) / 100, Math.round(((vwceValue / total) - 0.6) * 10000) / 100);

  // VWCE is ~77% against 60%, AAPL ~23% against 40%: AAPL is the emptier glass, so it gets the money first
  const { buys } = allocation.split;
  assert.equal(Math.round(buys.reduce((sum, buy) => sum + buy.amount, 0) * 100) / 100, 500);
  assert.equal(buys[0].ticker, "AAPL");
  assert.equal(buys.find((buy) => buy.ticker === "VWCE.MI").amount, 0, "VWCE is overweight: nothing, and nothing sold either");
  assert.equal(buys[0].price, 201.37);
  assert.equal(buys[0].whole_shares, Math.floor(500 / 201.37));
  const aaplAfter = allocation.split.after.find((row) => row.ticker === "AAPL");
  assert.ok(aaplAfter.drift_points > allocation.rows.find((row) => row.ticker === "AAPL").drift_points, "closer to its target after buying");

  const withoutMoney = await call("GET", "/investments/allocation");
  assert.equal(withoutMoney.split, null);
  assert.equal((await callApi("GET", "/investments/allocation?new_money=abc")).status, 400);

  await call("PUT", "/investments/targets", { targets: [] });
  const noTargets = await call("GET", "/investments/allocation?new_money=500");
  assert.equal(noTargets.targets_set, false);
  assert.equal(noTargets.split, null);
  assert.ok(noTargets.rows.every((row) => row.target_share === 0));
});

test("the drift threshold is a setting: validated, stored, and returned with the allocation", async () => {
  const { status, body } = await callApi("PUT", "/settings", { allocation_drift_threshold_points: 90 });
  assert.equal(status, 400);
  assert.match(body.error, /between 0.5 and 50/);
  assert.equal((await callApi("PUT", "/settings", { not_a_setting: 1 })).status, 400);
  const saved = await call("PUT", "/settings", { allocation_drift_threshold_points: 3.5 });
  assert.equal(saved.values.allocation_drift_threshold_points, 3.5);
  assert.equal((await call("GET", "/investments/allocation")).drift_threshold_points, 3.5);
  const { values, definitions } = await call("GET", "/settings");
  assert.equal(values.trend_highlight_share, definitions.trend_highlight_share.default, "the others keep their defaults");
});

test("targets and settings travel in the JSON backup; an older backup has neither", async () => {
  await call("PUT", "/investments/targets", { targets: [{ ticker: "VWCE.MI", target_percent: 80 }, { ticker: "AAPL", target_percent: 20 }] });
  const exported = await call("GET", "/export");
  assert.equal(exported.investment_targets.length, 2);
  assert.deepEqual(exported.app_settings, [{ key: "allocation_drift_threshold_points", value: "3.5" }]);

  await call("POST", "/import", { ...exported, investment_targets: [], app_settings: [] });
  assert.equal((await call("GET", "/investments/targets")).length, 0);
  await call("POST", "/import", exported);
  assert.deepEqual(await call("GET", "/investments/targets"), [{ ticker: "VWCE.MI", target_percent: 80 }, { ticker: "AAPL", target_percent: 20 }]);
  assert.equal((await call("GET", "/settings")).values.allocation_drift_threshold_points, 3.5);

  const { investment_targets: targetRows, app_settings: settingRows, ...versionFourteenBackup } = exported;
  await call("POST", "/import", { ...versionFourteenBackup, format_version: 14 });
  assert.deepEqual(await call("GET", "/investments/targets"), []);
  assert.equal((await call("GET", "/settings")).values.allocation_drift_threshold_points, 5);
});
