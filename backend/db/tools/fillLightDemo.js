/* npm run light:demo — fills netto light's EMPTY database (light.db) with a few months of made-up data,
 * so the light edition can be shown with something on every page.
 *
 * It only ever writes to light.db, and only when it has no accounts yet: anything else stops it before it
 * writes a thing. Your money.db is never opened (NETTO_EDITION=light points the database to light.db,
 * see config/projectPaths.js). To start again: stop `npm run light`, delete backend/db/light.db, run this again.
 *
 * Everything goes through the API, like typing it in the app: the validation, the balances and the recurring
 * rules all work as usual. The dates follow today: the last four months plus this month so far.
 * It can run while `npm run light` is open (SQLite lets both use the file); reload the page afterwards.
 */

process.env.NETTO_EDITION = "light"; // before anything from backend/ is required: it picks light.db

const path = require("path");
const express = require("express");
const { DATABASE_FILE } = require("../../config/projectPaths.js");

if (path.basename(DATABASE_FILE) !== "light.db") {
  console.error(`Stopping: this only fills light.db, and the database here is ${DATABASE_FILE}.`);
  process.exit(1);
}

const db = require("../databaseConnection.js");
const apiRouter = require("../../server/routes/apiRouter.js");
const { getTodayAsLocalDate } = require("../../server/utils/localDates.js");

const NUMBER_OF_PAST_MONTHS = 4;

// The same made-up amounts on every run: a tiny pseudo-random generator with a fixed seed
let seed = 20261017;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const amountBetween = (low, high) => Math.round((low + random() * (high - low)) * 100) / 100;

// "2026-10" -> "2026-07" for -3
function shiftMonth(yearMonth, months) {
  const [year, month] = yearMonth.split("-").map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
const dayOf = (yearMonth, day) => `${yearMonth}-${String(day).padStart(2, "0")}`;

async function startApi() {
  const app = express();
  app.use(express.json());
  app.use(apiRouter);
  const server = await new Promise((resolve) => { const started = app.listen(0, "127.0.0.1", () => resolve(started)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function call(method, apiPath, body) {
    const response = await fetch(baseUrl + apiPath, {
      method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const answer = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${method} ${apiPath} answered ${response.status}: ${text}`);
    return answer;
  }
  const stop = () => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); };
  return { call, stop };
}

async function fillDemo(call) {
  const today = getTodayAsLocalDate();
  const thisMonth = today.slice(0, 7);
  const firstMonth = shiftMonth(thisMonth, -NUMBER_OF_PAST_MONTHS);
  const months = Array.from({ length: NUMBER_OF_PAST_MONTHS + 1 }, (_, index) => shiftMonth(firstMonth, index));
  const isPast = (date) => date <= today;

  // ---- accounts (opened on the first day of the demo, so the net worth chart starts there) ----
  const addAccount = async (name, kind, openingBalance) => (await call("POST", "/accounts", { name, kind, opening_balance: openingBalance })).id;
  const account = {
    wallet: await addAccount("Wallet", "cash", 60),
    bank: await addAccount("Current account", "bank", 2400),
    savings: await addAccount("Savings", "savings", 6000),
    car: await addAccount("Car", "asset", 9000),
  };
  db.prepare(`UPDATE accounts SET open_date = ?`).run(dayOf(firstMonth, 1));

  // ---- categories ----
  const addCategory = async (name, kind) => (await call("POST", "/categories", { name, kind })).id;
  const category = {
    salary: await addCategory("Salary", "income"),
    otherIncome: await addCategory("Other", "income"),
    rent: await addCategory("Rent", "expense"),
    groceries: await addCategory("Groceries", "expense"),
    eatingOut: await addCategory("Eating out", "expense"),
    transport: await addCategory("Transport", "expense"),
    bills: await addCategory("Bills", "expense"),
    subscriptions: await addCategory("Subscriptions", "expense"),
    shopping: await addCategory("Shopping", "expense"),
    travel: await addCategory("Travel", "expense"),
  };

  // ---- recurring: salary, rent, phone, music (their past dates become transactions right away) ----
  const addRecurring = (rule) => call("POST", "/recurring-transactions", { repeat_unit: "month", repeat_interval: 1, start_date: dayOf(firstMonth, 1), ...rule });
  await addRecurring({ type: "income", amount: 2150, to_account_id: account.bank, category_id: category.salary, description: "Salary", start_date: dayOf(firstMonth, 27) });
  await addRecurring({ type: "expense", amount: 650, from_account_id: account.bank, category_id: category.rent, description: "Rent", start_date: dayOf(firstMonth, 2) });
  await addRecurring({ type: "expense", amount: 12.99, from_account_id: account.bank, category_id: category.bills, description: "Phone", start_date: dayOf(firstMonth, 5) });
  await addRecurring({ type: "expense", amount: 10.99, from_account_id: account.bank, category_id: category.subscriptions, description: "Music", start_date: dayOf(firstMonth, 15) });

  // ---- everyday spending, month by month ----
  const addTransaction = async (transaction) => { if (isPast(transaction.date)) await call("POST", "/transactions", transaction); };
  for (const month of months) {
    for (const day of [3, 10, 17, 24]) {
      await addTransaction({ type: "expense", amount: amountBetween(38, 85), from_account_id: account.bank, category_id: category.groceries, date: dayOf(month, day), description: "Supermarket" });
    }
    for (const day of [7, 14, 21]) {
      await addTransaction({ type: "expense", amount: amountBetween(12, 45), from_account_id: day === 14 ? account.wallet : account.bank, category_id: category.eatingOut, date: dayOf(month, day), description: day === 21 ? "Pizza with friends" : "Lunch out" });
    }
    await addTransaction({ type: "expense", amount: amountBetween(45, 70), from_account_id: account.bank, category_id: category.transport, date: dayOf(month, 9), description: "Fuel" });
    await addTransaction({ type: "expense", amount: amountBetween(2, 6), from_account_id: account.wallet, category_id: category.transport, date: dayOf(month, 12), description: "Parking" });
    await addTransaction({ type: "movement", amount: 80, from_account_id: account.bank, to_account_id: account.wallet, date: dayOf(month, 6), description: "Cash withdrawal" });
    await addTransaction({ type: "movement", amount: 250, from_account_id: account.bank, to_account_id: account.savings, date: dayOf(month, 28), description: "To savings" });
    await addTransaction({ type: "expense", amount: amountBetween(25, 120), from_account_id: account.bank, category_id: category.shopping, date: dayOf(month, 19), description: "Clothes" });
  }
  await addTransaction({ type: "income", amount: 40, to_account_id: account.bank, category_id: category.otherIncome, date: dayOf(months[1], 16), description: "Sold an old bike" });

  // ---- a trip, tagged, partly paid in pounds ----
  const tripMonth = months[NUMBER_OF_PAST_MONTHS - 1];
  const tripTag = (await call("POST", "/tags", { name: "London trip", start_date: dayOf(tripMonth, 11), end_date: dayOf(tripMonth, 14) })).id;
  const addTripExpense = (transaction) => addTransaction({ type: "expense", tag_ids: [tripTag], ...transaction });
  await addTripExpense({ amount: 148.6, from_account_id: account.bank, category_id: category.travel, date: dayOf(tripMonth, 2), description: "Flights" });
  await addTripExpense({ amount: 236.4, from_account_id: account.bank, category_id: category.travel, date: dayOf(tripMonth, 11), description: "Hotel, 3 nights", original_currency: "GBP", original_amount: 201 });
  await addTripExpense({ amount: 21.3, from_account_id: account.bank, category_id: category.eatingOut, date: dayOf(tripMonth, 12), description: "Fish and chips", original_currency: "GBP", original_amount: 18 });
  await addTripExpense({ amount: 35.5, from_account_id: account.bank, category_id: category.transport, date: dayOf(tripMonth, 12), description: "Underground", original_currency: "GBP", original_amount: 30 });
  await addTripExpense({ amount: 28.4, from_account_id: account.bank, category_id: category.shopping, date: dayOf(tripMonth, 13), description: "Market", original_currency: "GBP", original_amount: 24 });

  // ---- one ETF, bought twice (the server checks the ticker with Yahoo: offline, the demo just has no investments) ----
  try {
    await call("POST", "/investments/trades", { ticker: "VWCE.MI", side: "buy", shares: 8, price: 128.4, fees: 2, date: dayOf(months[0], 8), account_id: account.bank });
    await call("POST", "/investments/trades", { ticker: "VWCE.MI", side: "buy", shares: 4, price: 133.1, fees: 2, date: dayOf(months[2], 8), account_id: account.bank });
  } catch (error) {
    console.warn(`No investments in the demo: ${error.message}`);
  }
}

async function main() {
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM accounts`).get();
  if (count > 0) {
    console.error(`Stopping: light.db already has ${count} account(s). To start again, stop npm run light and delete backend/db/light.db first.`);
    process.exit(1);
  }
  const { call, stop } = await startApi();
  try {
    await fillDemo(call);
  } finally {
    await stop();
  }
  console.log("netto light's demo data is in light.db. Start it with npm run light, then open http://localhost:3002");
  db.close();      // writes everything into light.db itself
  process.exit(0); // the exchange-rate lookups may leave timers behind: nothing else to wait for
}

main().catch((error) => { console.error(error.message); process.exit(1); });
