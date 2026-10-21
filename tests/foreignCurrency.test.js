/* TRANSACTIONS PAID IN ANOTHER CURRENCY (migration 14)
 * The euros stay the real amount everywhere; the foreign amount, its market rate and the exchange cost are
 * extra information. The fake market data has fixed rates: 160 JPY, 1.25 USD and 0.3125 KWD per euro.
 */

const { openTestDatabase } = require("./helpers/testEnvironment.js"); // first: see that file
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset, callApiExpectingSuccess } = require("./helpers/fakeDataset.js");
const { listAllBalanceProblems } = require("./helpers/balanceRule.js");
const { setFakeExchangeRatesReachable } = require("./helpers/fakeYahooFinanceMarketData.js");
const { allMigrationsInOrder, LATEST_DATABASE_VERSION } = require("../backend/db/migrations/allMigrationsInOrder.js");
const { runPendingMigrations } = require("../backend/db/migrations/migrationRunner.js");
const { convertToMinorUnits, convertFromMinorUnits, getCurrencyDecimals, isForeignCurrency } = require("../backend/config/currencies.js");
const { fillMissingMarketRates } = require("../backend/server/services/exchangeRates.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);
const findTransaction = async (id) => (await call("GET", "/transactions")).find((transaction) => transaction.id === id);
const storedBalance = (accountId) => db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(accountId).balance;

before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);
});
after(() => stopServer());

// ---------- minor units ----------

test("each currency keeps its own decimals: JPY none, EUR two, KWD three", () => {
  assert.equal(getCurrencyDecimals("JPY"), 0);
  assert.equal(getCurrencyDecimals("EUR"), 2);
  assert.equal(getCurrencyDecimals("KWD"), 3);

  assert.equal(convertToMinorUnits(1200, "JPY"), 1200);      // ¥1.200 = 1200 yen: there is nothing smaller
  assert.equal(convertToMinorUnits("1200.4", "JPY"), 1200);
  assert.equal(convertToMinorUnits(12.34, "EUR"), 1234);     // cents
  assert.equal(convertToMinorUnits(1.005, "EUR"), 101);      // the same float-noise guard as the euros
  assert.equal(convertToMinorUnits(1.25, "KWD"), 1250);      // fils: thousandths
  assert.equal(convertToMinorUnits(0.001, "KWD"), 1);
  assert.equal(convertToMinorUnits(1.0005, "KWD"), 1001);

  assert.equal(convertFromMinorUnits(1200, "JPY"), 1200);
  assert.equal(convertFromMinorUnits(1234, "EUR"), 12.34);
  assert.equal(convertFromMinorUnits(1250, "KWD"), 1.25);
  assert.ok(Number.isNaN(convertToMinorUnits(5, "XYZ")));
  assert.ok(Number.isNaN(convertToMinorUnits("", "USD")));
  assert.equal(isForeignCurrency("EUR"), false, "a transaction can't be paid in euros as a foreign currency");
});

test("GET /currencies lists the foreign currencies with their decimals, without the euro", async () => {
  const currencies = await call("GET", "/currencies");
  assert.deepEqual(currencies.find((currency) => currency.code === "JPY"), { code: "JPY", name: "Japanese yen", decimals: 0 });
  assert.equal(currencies.find((currency) => currency.code === "KWD").decimals, 3);
  assert.ok(!currencies.some((currency) => currency.code === "EUR"));
});

// ---------- the market rate ----------

test("GET /exchange-rates gives the day's rate, and Friday's for a Sunday", async () => {
  const rate = await call("GET", "/exchange-rates/jpy?date=2026-10-07");
  assert.deepEqual(rate, { currency: "JPY", date: "2026-10-07", units_per_euro: 160, euros_per_unit: 1 / 160, rate_date: "2026-10-07" });
  const sunday = await call("GET", "/exchange-rates/USD?date=2026-10-11");
  assert.equal(sunday.rate_date, "2026-10-09");

  assert.equal((await callApi("GET", "/exchange-rates/EUR")).status, 400);
  assert.equal((await callApi("GET", "/exchange-rates/USD?date=2026-02-30")).status, 400);
  setFakeExchangeRatesReachable(false);
  try {
    const offline = await callApi("GET", "/exchange-rates/GBP?date=2026-10-07"); // not cached yet
    assert.equal(offline.status, 503);
    assert.match(offline.body.error, /type the euros charged/);
  } finally {
    setFakeExchangeRatesReachable(true);
  }
});

// ---------- saving, reading, editing ----------

test("a ¥1.200 ramen charged 7,60 €: balances use the euros, the yen and the exchange cost come along", async () => {
  const { cash } = dataset.accountIds;
  const balanceBefore = storedBalance(cash);
  const { id } = await call("POST", "/transactions", {
    type: "expense", amount: 7.6, from_account_id: cash, category_id: dataset.categoryIds.groceries, date: "2026-10-07",
    original_currency: "JPY", original_amount: 1200, description: "Ramen",
  });
  assert.equal(storedBalance(cash), balanceBefore - 760);
  assert.deepEqual(listAllBalanceProblems(db), []);

  const ramen = await findTransaction(id);
  assert.equal(ramen.amount, 7.6);
  assert.equal(ramen.original_currency, "JPY");
  assert.equal(ramen.original_amount, 1200);
  assert.equal(ramen.original_market_rate, 160);
  assert.equal(Math.round(ramen.charged_rate * 100) / 100, 157.89); // 1200 / 7.60
  assert.equal(ramen.exchange_cost, 0.1);                            // 7,60 € paid for what was worth 1200 / 160 = 7,50 €
  assert.equal(Math.round(ramen.exchange_cost_share * 10000) / 10000, 0.0133);
  assert.ok(!("original_amount_minor" in ramen), "the API speaks major units only");

  const stored = db.prepare(`SELECT original_currency, original_amount_minor, original_market_rate FROM transactions WHERE id = ?`).get(id);
  assert.deepEqual(stored, { original_currency: "JPY", original_amount_minor: 1200, original_market_rate: 160 });
});

test("3 decimals: 1,250 KWD is stored as 1250 fils, and a refund received in dinars has its cost the other way round", async () => {
  const { id } = await call("POST", "/transactions", {
    type: "income", amount: 3.9, to_account_id: dataset.accountIds.currentAccount, category_id: dataset.categoryIds.refund, date: "2026-10-06",
    original_currency: "KWD", original_amount: 1.25,
  });
  assert.equal(db.prepare(`SELECT original_amount_minor FROM transactions WHERE id = ?`).get(id).original_amount_minor, 1250);
  const refund = await findTransaction(id);
  assert.equal(refund.original_amount, 1.25);
  assert.equal(refund.exchange_cost, 0.1); // worth 1.25 / 0.3125 = 4,00 €, only 3,90 € arrived
});

test("what isn't a valid foreign amount is refused, and a lower-case code is fine", async () => {
  const base = { type: "expense", amount: 5, from_account_id: dataset.accountIds.cash, date: "2026-10-05" };
  const refusedBecause = async (extra, pattern) => {
    const { status, body } = await callApi("POST", "/transactions", { ...base, ...extra });
    assert.equal(status, 400, JSON.stringify(extra));
    assert.match(body.error, pattern);
  };
  await refusedBecause({ original_currency: "EUR", original_amount: 5 }, /already the transaction's amount/);
  await refusedBecause({ original_currency: "XYZ", original_amount: 5 }, /Unknown currency/);
  await refusedBecause({ original_currency: "USD" }, /at least 0.01/);
  await refusedBecause({ original_currency: "JPY", original_amount: 0.4 }, /at least 1/);      // rounds to 0 yen
  await refusedBecause({ original_currency: "KWD", original_amount: 0.0004 }, /at least 0.001/);
  const { id } = await call("POST", "/transactions", { ...base, original_currency: " usd ", original_amount: 6.25 });
  assert.equal((await findTransaction(id)).original_currency, "USD");
  const euroOnly = await call("POST", "/transactions", { ...base, original_currency: "", original_amount: 99 });
  assert.equal((await findTransaction(euroOnly.id)).original_amount, null, "no currency: any foreign amount is ignored");
});

test("an edit keeping currency and date keeps the stored rate; sending no currency makes it a euro transaction again", async () => {
  const { cash } = dataset.accountIds;
  const { id } = await call("POST", "/transactions", { type: "expense", amount: 10, from_account_id: cash, date: "2026-10-01", original_currency: "USD", original_amount: 12 });
  db.prepare(`UPDATE transactions SET original_market_rate = 1.2 WHERE id = ?`).run(id); // as if that day's rate had been 1.2

  await call("PUT", `/transactions/${id}`, { type: "expense", amount: 10.2, from_account_id: cash, date: "2026-10-01", original_currency: "USD", original_amount: 12 });
  assert.equal((await findTransaction(id)).original_market_rate, 1.2, "same day and currency: Yahoo isn't asked again");

  await call("PUT", `/transactions/${id}`, { type: "expense", amount: 10.2, from_account_id: cash, date: "2026-10-02", original_currency: "USD", original_amount: 12 });
  assert.equal((await findTransaction(id)).original_market_rate, 1.25, "another day: that day's rate");

  await call("PUT", `/transactions/${id}`, { type: "expense", amount: 10.2, from_account_id: cash, date: "2026-10-02" });
  const nowInEuros = await findTransaction(id);
  assert.equal(nowInEuros.original_currency, null);
  assert.equal(nowInEuros.original_market_rate, null);
  assert.equal(nowInEuros.exchange_cost, null);
});

test("offline: the transaction is still saved, and its market rate is filled in once Yahoo answers again", async () => {
  setFakeExchangeRatesReachable(false);
  let id;
  try {
    ({ id } = await call("POST", "/transactions", {
      type: "expense", amount: 20, from_account_id: dataset.accountIds.cash, date: "2026-09-29", original_currency: "GBP", original_amount: 15,
    }));
    const saved = await findTransaction(id);
    assert.equal(saved.original_amount, 15);
    assert.equal(saved.original_market_rate, null);
    assert.equal(saved.exchange_cost, null, "no rate, no cost yet");
    assert.equal(await fillMissingMarketRates(), 0, "still offline: nothing to fill");
  } finally {
    setFakeExchangeRatesReachable(true);
  }
  assert.ok(await fillMissingMarketRates() >= 1);
  const filled = await findTransaction(id);
  assert.equal(filled.original_market_rate, 0.8);
  assert.equal(filled.exchange_cost, 1.25); // 15 £ / 0.8 = 18,75 €, 20 € charged
});

// ---------- recurring ----------

test("a subscription billed in dollars: each transaction it adds carries the dollars, and gets its own market rate", async () => {
  const rule = await call("POST", "/recurring-transactions", {
    type: "expense", amount: 8.5, from_account_id: dataset.accountIds.currentAccount, description: "Streaming",
    repeat_unit: "month", repeat_interval: 1, start_date: "2026-08-03", original_currency: "USD", original_amount: 9.99,
  });
  const rules = await call("GET", "/recurring-transactions");
  const savedRule = rules.find((candidate) => candidate.id === rule.id);
  assert.equal(savedRule.original_currency, "USD");
  assert.equal(savedRule.original_amount, 9.99);

  await fillMissingMarketRates(); // what the server does right after posting
  const added = (await call("GET", "/transactions")).filter((transaction) => transaction.recurring_transaction_id === rule.id);
  assert.ok(added.length >= 3, "August, September, October");
  for (const transaction of added) {
    assert.equal(transaction.original_currency, "USD");
    assert.equal(transaction.original_amount, 9.99);
    assert.equal(transaction.original_market_rate, 1.25);
    assert.equal(transaction.exchange_cost, 0.51); // 9.99 / 1.25 = 7.992 -> 7,99 €; 8,50 € charged
  }
  assert.deepEqual(listAllBalanceProblems(db), []);
});

// ---------- trip totals ----------

test("a trip's totals: in euros, per original currency, and the exchange cost of the whole trip", async () => {
  const { cash, currentAccount } = dataset.accountIds;
  const tag = await call("POST", "/tags", { name: "Japan 2027 test", start_date: "2026-09-20", end_date: "2026-09-30" });
  const addTripTransaction = (transaction) => call("POST", "/transactions", { date: "2026-09-22", tag_ids: [tag.id], ...transaction });

  await addTripTransaction({ type: "expense", amount: 7.6, from_account_id: cash, original_currency: "JPY", original_amount: 1200 });   // cost 0,10
  await addTripTransaction({ type: "expense", amount: 19, from_account_id: cash, original_currency: "JPY", original_amount: 3000 });    // worth 18,75: 0,25
  await addTripTransaction({ type: "income", amount: 3, to_account_id: cash, original_currency: "JPY", original_amount: 500 });         // worth 3,125 -> 3,13: 0,13
  await addTripTransaction({ type: "movement", amount: 64, from_account_id: currentAccount, to_account_id: cash, original_currency: "JPY", original_amount: 10000 }); // ATM: worth 62,50: 1,50
  await addTripTransaction({ type: "expense", amount: 40, from_account_id: currentAccount, original_currency: "USD", original_amount: 50 }); // worth 40: 0
  await addTripTransaction({ type: "expense", amount: 120, from_account_id: currentAccount, description: "Flight, paid in euros" });

  const report = (await call("GET", "/tags/report")).find((row) => row.id === tag.id);
  assert.equal(report.spent, 186.6);   // every expense in euros, foreign or not: 7.60 + 19 + 40 + 120
  assert.equal(report.received, 3);
  assert.equal(report.exchange_cost, 1.98);
  const yen = report.by_currency.find((row) => row.currency === "JPY");
  assert.deepEqual(yen, { currency: "JPY", spent_original: 4200, received_original: 500, spent: 26.6, received: 3, exchange_cost: 1.98, count: 4, rateless_count: 0 });
  const dollars = report.by_currency.find((row) => row.currency === "USD");
  assert.equal(dollars.spent_original, 50);
  assert.equal(dollars.exchange_cost, 0);
  assert.deepEqual(report.by_currency.map((row) => row.currency), ["USD", "JPY"], "the currency with the most spent first");
  assert.deepEqual((await call("GET", "/tags/report")).find((row) => row.name === "Unused").by_currency, []);
});

// ---------- backups ----------

test("a JSON backup keeps the foreign amounts and rates; one from before version 14 imports as euros only", async () => {
  const exported = await call("GET", "/export");
  const foreignRowsBefore = db.prepare(`SELECT id, original_currency, original_amount_minor, original_market_rate FROM transactions WHERE original_currency IS NOT NULL ORDER BY id`).all();
  assert.ok(foreignRowsBefore.length >= 5);
  assert.ok(exported.recurring_transactions.some((rule) => rule.original_currency === "USD"));

  await call("POST", "/import", exported);
  assert.deepEqual(db.prepare(`SELECT id, original_currency, original_amount_minor, original_market_rate FROM transactions WHERE original_currency IS NOT NULL ORDER BY id`).all(), foreignRowsBefore);
  assert.equal(db.prepare(`SELECT original_amount_minor FROM recurring_transactions WHERE original_currency = 'USD'`).get().original_amount_minor, 999);
  assert.deepEqual(listAllBalanceProblems(db), []);

  const withoutForeignColumns = (row) => {
    const { original_currency, original_amount_minor, original_market_rate, ...rest } = row;
    return rest;
  };
  await call("POST", "/import", {
    ...exported, format_version: 13,
    transactions: exported.transactions.map(withoutForeignColumns),
    recurring_transactions: exported.recurring_transactions.map(withoutForeignColumns),
  });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE original_currency IS NOT NULL`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get().n, exported.transactions.length);
  await call("POST", "/import", exported); // everything back for any test after this one
});

// ---------- migration 14 ----------

test("migration 14 adds the columns to a version 13 database, keeps its data, and the columns refuse half-filled rows", () => {
  const versionThirteenDatabase = new Database(":memory:");
  versionThirteenDatabase.pragma("foreign_keys = OFF");
  for (const migration of allMigrationsInOrder.slice(0, 13)) migration(versionThirteenDatabase);
  versionThirteenDatabase.pragma("user_version = 13");
  versionThirteenDatabase.pragma("foreign_keys = ON");
  versionThirteenDatabase.exec(`
    INSERT INTO accounts (name, kind, opening_balance, balance, open_date) VALUES ('Bank', 'bank', 10000, 10000, '2026-01-01');
    INSERT INTO transactions (from_account_id, type, amount, date) VALUES (1, 'expense', 1234, '2026-02-01');
  `);

  const originalLog = console.log;
  console.log = () => {};
  try { runPendingMigrations(versionThirteenDatabase); } finally { console.log = originalLog; }

  assert.equal(versionThirteenDatabase.pragma("user_version", { simple: true }), LATEST_DATABASE_VERSION);
  assert.deepEqual(versionThirteenDatabase.prepare(`SELECT amount, original_currency, original_amount_minor, original_market_rate FROM transactions`).get(),
    { amount: 1234, original_currency: null, original_amount_minor: null, original_market_rate: null });
  assert.equal(versionThirteenDatabase.prepare(`SELECT balance FROM accounts`).get().balance, 8766);

  const insert = (columns, values) => versionThirteenDatabase.prepare(`INSERT INTO transactions (from_account_id, type, amount, date, ${columns}) VALUES (1, 'expense', 100, '2026-03-01', ${values})`).run();
  assert.throws(() => insert("original_currency", "'JPY'"), /CHECK/, "a currency without an amount");
  assert.throws(() => insert("original_amount_minor", "1200"), /CHECK/, "an amount without a currency");
  assert.throws(() => insert("original_currency, original_amount_minor", "'EUR', 100"), /CHECK/, "euros aren't a foreign currency");
  assert.throws(() => insert("original_currency, original_amount_minor", "'jpy', 100"), /CHECK/, "codes are upper case");
  assert.throws(() => insert("original_currency, original_amount_minor", "'JPY', 0"), /CHECK/);
  assert.throws(() => insert("original_currency, original_amount_minor, original_market_rate", "'JPY', 1200, -1"), /CHECK/);
  insert("original_currency, original_amount_minor, original_market_rate", "'JPY', 1200, 160.5");
  assert.throws(() => versionThirteenDatabase.prepare(`INSERT INTO recurring_transactions (type, amount, from_account_id, repeat_unit, start_date, created_at, original_currency)
    VALUES ('expense', 100, 1, 'month', '2026-01-01', '2026-01-01', 'USD')`).run(), /CHECK/);
  assert.deepEqual(versionThirteenDatabase.pragma("foreign_key_check"), []);
});
