/* A SMALL FAKE DATASET, the same for every test file that needs data.
 * Built through the API (like you would in the app), so it also goes through the validation and the
 * triggers. Every date is in the past, so the dataset is the same whatever day the tests run on
 * (apart from today's reconciliation and the recurring rent, which keeps adding a month as time passes).
 *
 *   accounts      one of every kind: cash, current account, savings, meal vouchers (restricted),
 *                 a car (personal-use asset), and an old card that was emptied and closed
 *   categories    income: Salary, Refund, Gift   expense: Rent, Groceries, Gift, Transport  ("Gift" exists in both kinds)
 *   transactions  ~21 months of salary, groceries, savings transfers, cash withdrawals, vouchers, gifts
 *   reconciliation  the cash counted today is 3.40 € less than recorded
 *   recurring     rent, every month from Feb 2025 (its past months are added at once)
 *   trades        VWCE.MI: two buys and a sell, paid from / into accounts
 *                 AAPL: a buy with no account (an "opening position") and a sell into the current account
 *   tags          "Lisbon 2025" (10–14 Sep 2025): a train, groceries, cash withdrawn, a refund
 *                 "Work" (no dates, used once, also on a Lisbon transaction) and "Unused" (on nothing)
 */

const FIRST_MONTH = "2025-01";
const NUMBER_OF_MONTHS = 21; // 2025-01 … 2026-09

// "2025-01" + 3 -> "2025-04"
function addMonthsToYearMonth(yearMonth, numberOfMonths) {
  const [year, month] = yearMonth.split("-").map(Number);
  const monthIndex = year * 12 + (month - 1) + numberOfMonths;
  return `${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, "0")}`;
}

// Calls the API and stops with a clear message if the call didn't work: a broken dataset
// would otherwise show up later as a confusing failure in an unrelated test.
async function callApiExpectingSuccess(callApi, method, path, body) {
  const { status, body: responseBody } = await callApi(method, path, body);
  if (status >= 400) throw new Error(`Building the fake dataset: ${method} ${path} answered ${status}: ${JSON.stringify(responseBody)}`);
  return responseBody;
}

async function buildFakeDataset(callApi, db) {
  const call = (method, path, body) => callApiExpectingSuccess(callApi, method, path, body);

  // ---- accounts ----
  const addAccount = async (name, kind, openingBalance) => (await call("POST", "/accounts", { name, kind, opening_balance: openingBalance })).id;
  const accountIds = {
    cash: await addAccount("Cash", "cash", 50),
    currentAccount: await addAccount("Current account", "bank", 1500),
    savings: await addAccount("Savings", "savings", 5000),
    mealVouchers: await addAccount("Meal vouchers", "restricted", 80),
    car: await addAccount("Car", "asset", 12000),
    oldCard: await addAccount("Old card", "bank", 0),
  };
  // The API always opens an account today. A real database has accounts opened over many months, and
  // the Statements count an account's opening balance as "starting balance added" on the day it starts,
  // so the open dates are spread out here (open_date is a plain column: no trigger depends on it).
  const setOpenDate = db.prepare(`UPDATE accounts SET open_date = ? WHERE id = ?`);
  setOpenDate.run("2025-01-01", accountIds.currentAccount);
  setOpenDate.run("2025-01-01", accountIds.savings);
  setOpenDate.run("2025-06-15", accountIds.cash);
  setOpenDate.run("2025-09-01", accountIds.car);
  setOpenDate.run("2025-03-01", accountIds.oldCard);
  // Meal vouchers keeps today's date, but its first transaction is earlier: it then starts on that day

  // ---- categories ----
  const addCategory = async (name, kind) => (await call("POST", "/categories", { name, kind })).id;
  const categoryIds = {
    salary: await addCategory("Salary", "income"),
    refund: await addCategory("Refund", "income"),
    giftReceived: await addCategory("Gift", "income"),
    rent: await addCategory("Rent", "expense"),
    groceries: await addCategory("Groceries", "expense"),
    giftGiven: await addCategory("Gift", "expense"),
    transport: await addCategory("Transport", "expense"),
  };

  // ---- transactions ----
  const transactionIds = [];
  const addTransaction = async (transaction) => transactionIds.push((await call("POST", "/transactions", transaction)).id);

  for (let monthNumber = 0; monthNumber < NUMBER_OF_MONTHS; monthNumber++) {
    const month = addMonthsToYearMonth(FIRST_MONTH, monthNumber);
    await addTransaction({ type: "income", amount: 2100.5, to_account_id: accountIds.currentAccount, category_id: categoryIds.salary, date: `${month}-27`, description: "Salary" });
    await addTransaction({ type: "expense", amount: 87.3 + monthNumber * 3.17, from_account_id: accountIds.currentAccount, category_id: categoryIds.groceries, date: `${month}-10` });
    await addTransaction({ type: "income", amount: 8 * 20, to_account_id: accountIds.mealVouchers, category_id: categoryIds.salary, date: `${month}-02`, description: "Meal vouchers" });
    await addTransaction({ type: "expense", amount: 151.25, from_account_id: accountIds.mealVouchers, category_id: categoryIds.groceries, date: `${month}-20` });
    if (monthNumber % 3 === 2) {
      await addTransaction({ type: "movement", amount: 300, from_account_id: accountIds.currentAccount, to_account_id: accountIds.savings, date: `${month}-28` });
    }
    if (monthNumber >= 6 && monthNumber % 2 === 0) {
      await addTransaction({ type: "movement", amount: 100, from_account_id: accountIds.currentAccount, to_account_id: accountIds.cash, date: `${month}-05` });
      await addTransaction({ type: "expense", amount: 42.8, from_account_id: accountIds.cash, category_id: categoryIds.groceries, date: `${month}-06` });
    }
  }
  await addTransaction({ type: "income", amount: 19.99, to_account_id: accountIds.cash, category_id: categoryIds.refund, date: "2025-07-03" });
  await addTransaction({ type: "expense", amount: 50, from_account_id: accountIds.cash, category_id: categoryIds.giftGiven, date: "2025-12-20" });
  await addTransaction({ type: "income", amount: 100, to_account_id: accountIds.currentAccount, category_id: categoryIds.giftReceived, date: "2025-12-25" });
  // A movement may use a category of either kind (here an expense one)
  await addTransaction({ type: "movement", amount: 25, from_account_id: accountIds.cash, to_account_id: accountIds.currentAccount, category_id: categoryIds.giftGiven, date: "2026-01-02" });

  // The old card: used for a while, emptied, then closed
  await addTransaction({ type: "income", amount: 20, to_account_id: accountIds.oldCard, category_id: categoryIds.refund, date: "2025-03-10" });
  await addTransaction({ type: "movement", amount: 20, from_account_id: accountIds.oldCard, to_account_id: accountIds.currentAccount, date: "2025-04-01" });
  await call("POST", `/accounts/${accountIds.oldCard}/close`);

  // ---- a reconciliation: 3.40 € less cash than recorded ----
  const cashBalance = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(accountIds.cash).balance;
  await call("POST", `/accounts/${accountIds.cash}/reconcile`, { counted: (cashBalance - 340) / 100 });

  // ---- a recurring rule: its past months become transactions right away ----
  const recurringRuleId = (await call("POST", "/recurring-transactions", {
    type: "expense", amount: 700, from_account_id: accountIds.currentAccount, category_id: categoryIds.rent,
    description: "Rent", repeat_unit: "month", repeat_interval: 1, start_date: "2025-02-01",
  })).id;

  // ---- trades on two tickers ----
  const addTrade = async (trade) => (await call("POST", "/investments/trades", trade)).id;
  const tradeIds = [
    await addTrade({ ticker: "VWCE.MI", side: "buy", shares: 10, price: 100, fees: 1.5, date: "2025-02-10", account_id: accountIds.currentAccount }),
    await addTrade({ ticker: "VWCE.MI", side: "buy", shares: 5, price: 110.2, fees: 2, date: "2025-08-01", account_id: accountIds.currentAccount }),
    await addTrade({ ticker: "VWCE.MI", side: "sell", shares: 4, price: 121.7, fees: 2, date: "2026-03-02", account_id: accountIds.savings }),
    await addTrade({ ticker: "AAPL", side: "buy", shares: 3, price: 180.33, date: "2025-05-05" }), // no account: an opening position
    await addTrade({ ticker: "AAPL", side: "sell", shares: 1, price: 205, fees: 1, date: "2026-01-15", account_id: accountIds.currentAccount }),
  ];

  // ---- tags: a short trip across several categories ----
  const addTag = async (name, startDate, endDate) => (await call("POST", "/tags", { name, start_date: startDate, end_date: endDate })).id;
  const tagIds = {
    lisbon: await addTag("Lisbon 2025", "2025-09-10", "2025-09-14"),
    unused: await addTag("Unused"),
  };
  const lisbonTransactionIds = [];
  const addLisbonTransaction = async (transaction) => {
    const { id } = await call("POST", "/transactions", { ...transaction, tag_ids: [tagIds.lisbon], new_tag_names: transaction.new_tag_names });
    lisbonTransactionIds.push(id);
    transactionIds.push(id);
  };
  await addLisbonTransaction({ type: "expense", amount: 64.9, from_account_id: accountIds.currentAccount, category_id: categoryIds.transport, date: "2025-09-10", description: "Train to Lisbon", new_tag_names: ["Work"] });
  await addLisbonTransaction({ type: "expense", amount: 23.45, from_account_id: accountIds.cash, category_id: categoryIds.groceries, date: "2025-09-11" });
  await addLisbonTransaction({ type: "expense", amount: 12.1, from_account_id: accountIds.cash, category_id: categoryIds.transport, date: "2025-09-12", description: "Tram" });
  await addLisbonTransaction({ type: "movement", amount: 80, from_account_id: accountIds.currentAccount, to_account_id: accountIds.cash, date: "2025-09-10", description: "Cash for the trip" });
  await addLisbonTransaction({ type: "income", amount: 15, to_account_id: accountIds.currentAccount, category_id: categoryIds.refund, date: "2025-09-20", description: "Train delay refund" });
  tagIds.work = db.prepare(`SELECT id FROM tags WHERE name = 'Work'`).get().id;

  return { accountIds, categoryIds, transactionIds, recurringRuleId, tradeIds, tagIds, lisbonTransactionIds };
}

module.exports = { buildFakeDataset, callApiExpectingSuccess };
