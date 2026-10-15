/* INVESTMENT RETURNS (services/rateOfReturn.js, services/investmentReturns.js)
 * XIRR checked against Excel's own published example and against cases whose answer has a formula; edge cases
 * (no flows, all zero, one sign only, a single day, Newton stepping off the curve); the textbook difference
 * between time- and money-weighted returns; and the Statements' returns on the fake dataset, where the
 * time-weighted return is recomputed the slow way (every single day) to check the shortcut.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { calculateXirr, solveRateOfReturn, calculateMoneyWeightedReturn, calculateTimeWeightedReturn, annualizeReturn, countDaysBetween } = require("../backend/server/services/rateOfReturn.js");
const { buildFinancialStatements } = require("../backend/server/services/financialStatements.js");
const { calculateInvestmentsValuePerDay, addDays } = require("../backend/server/services/netWorthHistory.js");

const db = openTestDatabase();
let callApi, stopServer;

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  await buildFakeDataset(callApi, db);
});
after(() => stopServer());

const assertClose = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} expected ${expected}, got ${actual}`);

// ---------- XIRR ----------

test("XIRR matches Excel's documented example (37.34%)", () => {
  // support.microsoft.com, XIRR function: =XIRR(values, dates) -> 0.373362535
  const rate = calculateXirr([
    { date: "2008-01-01", amount: -10000 },
    { date: "2008-03-01", amount: 2750 },
    { date: "2008-10-30", amount: 4250 },
    { date: "2009-02-15", amount: 3250 },
    { date: "2009-04-01", amount: 2750 },
  ]);
  assertClose(rate, 0.373362535, 1e-8); // Microsoft prints it rounded to 9 decimals
});

test("XIRR on cases with a closed formula, counting 365-day years like Excel", () => {
  // +10% over 2020 (a leap year: 366 days): 1.1^(365/366) − 1
  assertClose(calculateXirr([{ date: "2020-01-01", amount: -1000 }, { date: "2021-01-01", amount: 1100 }]), Math.pow(1.1, 365 / 366) - 1, 1e-12);
  // doubling in two years (731 days): 2^(365/731) − 1 ≈ 41.4%
  assertClose(calculateXirr([{ date: "2020-01-01", amount: -1000 }, { date: "2022-01-01", amount: 2000 }]), Math.pow(2, 365 / 731) - 1, 1e-12);
  // a loss: −25% in exactly 365 days
  assertClose(calculateXirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: 750 }]), -0.25, 1e-12);
  // two deposits a year apart, 10% a year on everything: the rate is exactly 10%
  assertClose(calculateXirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: -1000 }, { date: "2023-01-01", amount: 1000 * 1.1 * 1.1 + 1000 * 1.1 }]), 0.1, 1e-10);
});

test("no rate of return without money both in and out", () => {
  assert.equal(calculateXirr([]), null);
  assert.equal(calculateXirr([{ date: "2020-01-01", amount: 0 }, { date: "2021-01-01", amount: 0 }]), null, "all zero");
  assert.equal(calculateXirr([{ date: "2020-01-01", amount: -100 }, { date: "2021-01-01", amount: -50 }]), null, "only money in");
  assert.equal(calculateXirr([{ date: "2020-01-01", amount: 100 }]), null, "only money out");
});

test("when Newton's method steps below −100%, bisection still finds the rate", () => {
  // −90% in a year. From the 10% guess Newton's first step lands at about −10.9 (below −100%: impossible)
  const flows = [{ time: 0, amount: -100 }, { time: 1, amount: 10 }];
  assertClose(solveRateOfReturn(flows), -0.9, 1e-9);
});

test("extreme short-term returns are still solved, and every answer really zeroes the cash flows", () => {
  // +50% in one day: the yearly rate is about 1.5^365 − 1 ≈ 1e64
  const rate = calculateXirr([{ date: "2020-01-01", amount: -100 }, { date: "2020-01-02", amount: 150 }]);
  assertClose(Math.log(1 + rate), 365 * Math.log(1.5), 1e-6);
  // a pseudo-random set of flows: the present value at the answer is ~0
  let seed = 7;
  const nextRandom = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 50; round++) {
    const flows = [{ time: 0, amount: -1000 * (0.5 + nextRandom()) }];
    for (let index = 1; index < 6; index++) flows.push({ time: index * nextRandom(), amount: (nextRandom() - 0.4) * 500 });
    flows.push({ time: 3, amount: 1500 * nextRandom() + 200 });
    const solved = solveRateOfReturn(flows);
    if (solved === null) continue;
    const presentValue = flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + solved, flow.time), 0);
    assertClose(presentValue, 0, 1e-6, `round ${round}`);
  }
});

// ---------- money- vs time-weighted ----------

// Values at the end of each day, as a function for calculateTimeWeightedReturn
const valuesFrom = (valueByDay) => (day) => valueByDay[day] ?? 0;

test("the textbook case: good investments, bad timing", () => {
  // 100 € held; day 1: +10% (110); day 2: 100 € more is put in at the start, then everything falls 10% (189)
  // TWR: 1.10 × 0.90 − 1 = −1% (the investments). MWR: 189 − 100 − 100 at the end of a 2-day period = −11%
  // (more money was in during the bad day: the timing cost 10 points)
  const period = { startDay: "2026-01-01", endDay: "2026-01-03" };
  const trades = [{ date: "2026-01-03", side: "buy", amount: 100 }];
  const timeWeighted = calculateTimeWeightedReturn({ ...period, trades, addDays, valueOnDay: valuesFrom({ "2026-01-01": 100, "2026-01-02": 110, "2026-01-03": 189 }) });
  const moneyWeighted = calculateMoneyWeightedReturn({ ...period, trades, startValue: 100, endValue: 189 });
  assertClose(timeWeighted.period, -0.01, 1e-12);
  assertClose(moneyWeighted.period, -0.11, 1e-9);
});

test("with no money in or out, both returns are simply end ÷ start − 1", () => {
  const period = { startDay: "2025-12-31", endDay: "2026-12-31" };
  const timeWeighted = calculateTimeWeightedReturn({ ...period, trades: [], addDays, valueOnDay: valuesFrom({ "2025-12-31": 2000, "2026-12-31": 2150 }) });
  const moneyWeighted = calculateMoneyWeightedReturn({ ...period, trades: [], startValue: 2000, endValue: 2150 });
  assertClose(timeWeighted.period, 0.075, 1e-12);
  assertClose(moneyWeighted.period, 0.075, 1e-9);
  assertClose(moneyWeighted.annual, 0.075, 1e-9, "exactly a year: the yearly return is the same");
});

test("a single day, a buy and a sell on the same day, and nothing held", () => {
  // bought for 1,000 at the start of the day, worth 1,010 at its end: +1% in one day
  const oneDay = { startDay: "2026-03-01", endDay: "2026-03-02" };
  const trades = [{ date: "2026-03-02", side: "buy", amount: 1000 }];
  const timeWeighted = calculateTimeWeightedReturn({ ...oneDay, trades, addDays, valueOnDay: valuesFrom({ "2026-03-02": 1010 }) });
  assertClose(timeWeighted.period, 0.01, 1e-12);
  assertClose(timeWeighted.annual, Math.pow(1.01, 365) - 1, 1e-9, "annualized, as asked: shown as a big number, so the page shows the plain one too");
  // bought for 500 and sold for 520 the same day: +4%
  const roundTrip = calculateTimeWeightedReturn({ ...oneDay, addDays, valueOnDay: valuesFrom({}), trades: [{ date: "2026-03-02", side: "buy", amount: 500 }, { date: "2026-03-02", side: "sell", amount: 520 }] });
  assertClose(roundTrip.period, 0.04, 1e-12);
  // nothing held, nothing traded
  assert.equal(calculateTimeWeightedReturn({ ...oneDay, trades: [], addDays, valueOnDay: valuesFrom({}) }), null);
  assert.equal(calculateMoneyWeightedReturn({ ...oneDay, trades: [], startValue: 0, endValue: 0 }), null);
  assert.equal(annualizeReturn(0.5, 0), null);
});

// ---------- on the dataset, through the Statements ----------

test("per ticker and in total: the gain matches the bridge, and the money-weighted rate zeroes the real cash flows", async () => {
  const from = "2025-01-01", to = "2026-06-30";
  const statements = await buildFinancialStatements(from, to);
  const returns = statements.investment_returns;
  assert.deepEqual(returns.tickers.map((ticker) => ticker.ticker), ["AAPL", "VWCE.MI"]);

  const bridgeInvestmentResults = statements.bridge.steps.find((step) => step.key === "investment_results").amount;
  assert.equal(Math.round(returns.total.gain * 100), Math.round(bridgeInvestmentResults * 100), "total gain = the bridge's investment results");
  const tickersGain = returns.tickers.reduce((sum, ticker) => sum + Math.round(ticker.gain * 100), 0);
  assert.equal(tickersGain, Math.round(returns.total.gain * 100), "the tickers add up to the total");

  // rebuild the total's cash flows from the database and check the rate really zeroes them
  const openingDay = addDays(from, -1), days = countDaysBetween(openingDay, to);
  const trades = db.prepare(`SELECT date, side, amount FROM investment_trades WHERE date BETWEEN ? AND ?`).all(from, to);
  const flows = [{ time: 0, amount: -returns.total.opening * 100 }, { time: 1, amount: returns.total.closing * 100 },
    ...trades.map((trade) => ({ time: countDaysBetween(openingDay, trade.date) / days, amount: trade.side === "buy" ? -trade.amount : trade.amount }))];
  const presentValue = flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + returns.total.money_weighted.period, flow.time), 0);
  assertClose(presentValue, 0, 1e-4);
  assertClose(returns.total.money_weighted.annual, Math.pow(1 + returns.total.money_weighted.period, 365 / days) - 1, 1e-12);
});

test("the time-weighted shortcut (trade days only) equals chaining every single day", async () => {
  const from = "2025-02-01", to = "2026-03-31";
  const statements = await buildFinancialStatements(from, to);
  const openingDay = addDays(from, -1);
  const everyDay = [];
  for (let day = openingDay; day <= to; day = addDays(day, 1)) everyDay.push(day);
  const valuation = await calculateInvestmentsValuePerDay(everyDay);
  const trades = db.prepare(`SELECT ticker, date, side, amount FROM investment_trades WHERE date BETWEEN ? AND ?`).all(from, to);

  const chainEveryDay = (valuesInCents, tradesToCount) => {
    let growth = 1;
    for (let index = 1; index < everyDay.length; index++) {
      const tradesOfDay = tradesToCount.filter((trade) => trade.date === everyDay[index]);
      const bought = tradesOfDay.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + trade.amount, 0);
      const sold = tradesOfDay.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + trade.amount, 0);
      const valueAtStart = valuesInCents[index - 1] + bought;
      if (valueAtStart > 0) growth *= (valuesInCents[index] + sold) / valueAtStart;
    }
    return growth - 1;
  };
  assertClose(statements.investment_returns.total.time_weighted.period, chainEveryDay(valuation.totals, trades), 1e-9, "total");
  for (const tickerResult of valuation.tickerResults) {
    const shown = statements.investment_returns.tickers.find((ticker) => ticker.ticker === tickerResult.ticker);
    assertClose(shown.time_weighted.period, chainEveryDay(tickerResult.valuesInCents, trades.filter((trade) => trade.ticker === tickerResult.ticker)), 1e-9, tickerResult.ticker);
  }
});

test("a period with no investments has no returns; a single day works", async () => {
  const empty = await buildFinancialStatements("2024-03-01", "2024-03-31");
  assert.deepEqual(empty.investment_returns.tickers, []);
  assert.equal(empty.investment_returns.total.money_weighted, null);
  assert.equal(empty.investment_returns.total.time_weighted, null);

  const tradeDay = await buildFinancialStatements("2026-03-02", "2026-03-02"); // the VWCE.MI sell
  assert.equal(tradeDay.investment_returns.days, 1);
  assert.ok(tradeDay.investment_returns.total.time_weighted !== null);
  assert.ok(tradeDay.bridge.unexplained === 0);
});

test("GET /statements includes the returns", async () => {
  const statements = await callApiExpectingSuccess(callApi, "GET", "/statements?from=2025-01-01&to=2026-06-30");
  assert.ok(statements.investment_returns.total.money_weighted.period > -1);
});

test("'All time' (from 1970) starts at the first record, so day-based maths isn't spread over decades", async () => {
  const statements = await callApiExpectingSuccess(callApi, "GET", "/statements?from=1970-01-01&to=2026-06-30");
  const firstRecord = db.prepare(`SELECT MIN(day) AS day FROM (SELECT MIN(open_date) AS day FROM accounts UNION ALL SELECT MIN(date) FROM transactions UNION ALL SELECT MIN(date) FROM investment_trades)`).get().day;
  assert.equal(statements.from, firstRecord);
  assert.equal(statements.investment_returns.days, countDaysBetween(addDays(firstRecord, -1), "2026-06-30"));
  // a period entirely before the first record is left as asked (all zeros)
  const before = await callApiExpectingSuccess(callApi, "GET", "/statements?from=1990-01-01&to=1990-12-31");
  assert.equal(before.from, "1990-01-01");
  assert.equal(before.balance_sheet.closing, 0);
});
