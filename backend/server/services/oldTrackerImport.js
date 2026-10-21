/* BRINGING THE OLD TRACKER'S HISTORY INTO NETTO (Settings > Import from the old tracker)
 * The file is read by services/oldTrackerCsv.js; this file decides what each line becomes, shows it as a preview
 * (buildImportPlan: nothing is saved), and saves it when you confirm (applyImportPlan: all or nothing).
 *
 * WHAT GETS IMPORTED: every income and expense of the old tracker dated before netto's first day (the day the
 * first account was opened in netto), with netto's categories. Obvious slips are corrected and listed:
 * coffee and breakfasts filed under Food go to Coffee, fuel / parking / public transport to Transport, clothes
 * filed under Products to Clothes, the dentist to Medicine. The old "Ricalcolo" lines (made to match the bank,
 * not real spending) become recounts (adjustments), like netto's own "Recount".
 *
 * WITHOUT CHANGING TODAY'S BALANCES: before netto's first day there are no netto accounts to put the money in. So
 * the history goes into one account of its own, "Old tracker":
 *   1 Jan    it opens with the old tracker's cash at the start of the year ("Cash - Liquidity", 2025 column)
 *   …        every old income and expense; the money moved to the ETFs (bought with it) and to the car
 *   day 1    the difference between what it holds and what your netto accounts started with is a recount
 *            (the two trackers didn't agree to the cent), then it hands each netto account its opening balance
 *            as a movement: the account now starts at 0 and receives that money from "Old tracker"
 *            (a movement on the account's own opening day, so the account starts on the same day as before)
 *   then     it's closed, at 0
 * Every netto account ends with exactly the balance it has now; nothing about today changes. What changes is
 * the past: the net worth chart, the statements, the averages and the goals now see the months before netto.
 *
 * THE CAR AND THE ETFs: when the old tracker's numbers lead exactly to what netto started with, the history is
 * rebuilt there too: the car account opens on 1 Jan at its old value and receives the money moved to it; an ETF's
 * "opening position" (all the shares, on netto's first day) becomes the shares held on 1 Jan plus each purchase
 * of the year, paid from "Old tracker". The cost of each holding stays exactly what netto has now (if the old
 * prices differ by a few cents, the opening position, or else the last purchase, takes the difference). When the
 * numbers don't lead there, that part is left as it is and the preview says so.
 *
 * Money in cents here; the route converts to euros.
 */

const db = require("../../db/databaseConnection.js");
const { MONTH_NAMES } = require("./oldTrackerCsv.js");
const { syncCashTransactionOfTrade } = require("./tradeCashTransactions.js");
const { rebuildHoldingFromTrades } = require("./holdingsCalculator.js");

const HISTORY_ACCOUNT_NAME = "Old tracker";
const OPENING_POSITION_NOTE_START = "Opening position";

// ---------- what each line becomes ----------

// The old categories, as netto's (expense side). The old tracker's own totals use the plural labels on the right.
const EXPENSE_CATEGORIES = {
  Grocery: { name: "Grocery", totalLabel: "Grocery" },
  Food: { name: "Food", totalLabel: "Food" },
  Product: { name: "Products", totalLabel: "Products" },
  Service: { name: "Service", totalLabel: "Services" },
  Car: { name: "Car", totalLabel: "Car" },
  Transport: { name: "Transport", totalLabel: "Transport" },
  Necessity: { name: "Necessities", totalLabel: "Necessities" },
  Clothes: { name: "Clothes", totalLabel: "Clothes" },
  Leisure: { name: "Leisure", totalLabel: "Leisure" },
  Gift: { name: "Gift", totalLabel: "Gift" },
  Rent: { name: "Rent", totalLabel: "Rent" },
  "Investment fee": { name: "Investment fees", totalLabel: "Investment fee" },
};
// New categories netto doesn't have yet, with their spending pace ("habitual" = daily, "one-off" = occasional)
const NEW_CATEGORY_PACE = { Transport: "occasional", Car: "occasional", Leisure: "occasional" };

// [test on the description, netto category, why]: the corrections, checked in this order
const CORRECTIONS = [
  [/^(caff[eè]|t[eè]$|colazione|brioche|tessera caff)/i, "Coffee", "coffee and breakfast were filed under Food; netto has a Coffee category", ["Food"]],
  [/^benzina|parcheggio|actv|autostrada/i, "Transport", "fuel, parking and public transport go to Transport", null],
  [/pile|guscio|vestiti|pantaloni|piumino|giubbotto|scarpe|felpa|maglia/i, "Clothes", "clothing filed under Products", ["Product"]],
  [/dentist|apri naso|farmacia|medic/i, "Medicine", "health spending goes to Medicine", ["Service", "Product"]],
];

// Income: the old income category and the description decide
function classifyIncome(line) {
  const text = `${line.incomeCategory} ${line.description}`;
  if (/^ricalcolo/i.test(line.description)) return { type: "adjustment", direction: "in" };
  if (/buoni/i.test(text)) return { type: "income", category: "Vouchers" };
  if (line.incomeCategory === "Job") return { type: "income", category: /chiosco|mance/i.test(text) ? "Salary - Chiosco" : "Salary - Office" };
  if (/^stipendio/i.test(line.description)) return { type: "income", category: /chiosco/i.test(text) ? "Salary - Chiosco" : "Salary - Office" };
  if (line.incomeCategory === "Gift" || /^regalo/i.test(line.description)) return { type: "income", category: "Gifts received" };
  if (line.incomeCategory === "Capital gain" || /^interessi/i.test(line.description)) return { type: "income", category: "Interest" };
  if (line.incomeCategory === "Dividend") return { type: "income", category: "Dividends" };
  if (/^rimborso|divisione|resto/i.test(line.description)) return { type: "income", category: "Refunds" };
  return { type: "income", category: "Other income" };
}

// One line of the old tracker -> { type, category, direction, correction, flag }
function classifyLine(line) {
  if (line.category === "Income") {
    const result = classifyIncome(line);
    if (result.type === "adjustment") return { ...result, category: null, correction: "a recalculation to match the bank, not real income: imported as a recount" };
    return { ...result, flag: line.incomeCategory ? null : "had no income category in the old tracker, so its totals left it out" };
  }
  if (/^ricalcolo/i.test(line.description)) {
    return { type: "adjustment", direction: "out", category: null, correction: "a recalculation to match the bank, not real spending: imported as a recount" };
  }
  const usual = EXPENSE_CATEGORIES[line.category]?.name ?? line.category;
  for (const [test, category, why, onlyFrom] of CORRECTIONS) {
    if (test.test(line.description) && (!onlyFrom || onlyFrom.includes(line.category)) && category !== usual) {
      return { type: "expense", category, correction: why };
    }
  }
  const flag = /cauzione/i.test(line.description) ? "a deposit, money you should get back: imported as Rent spending (untick to leave it out)" : null;
  return { type: "expense", category: usual, flag };
}

// ---------- reading netto as it is now ----------

function readNetto() {
  const accounts = db.prepare(`SELECT id, name, kind, opening_balance, balance, open_date, closed_at FROM accounts ORDER BY open_date, id`).all();
  const firstDay = accounts.length ? accounts[0].open_date : null;
  const categories = db.prepare(`SELECT id, name, kind FROM categories`).all();
  const trades = db.prepare(`SELECT * FROM investment_trades ORDER BY date, id`).all();
  const firstTransactionDay = db.prepare(`SELECT MIN(date) AS day FROM transactions`).get().day;
  return { accounts, firstDay, categories, trades, firstTransactionDay };
}

const findCategory = (categories, name, kind) => categories.find((category) => category.kind === kind && category.name.toLowerCase() === name.toLowerCase());

// ---------- the car ----------

// The money moved to the car, if the old values lead exactly to netto's opening value of a car account
function planCar(parsed, netto, firstDayMonthIndex) {
  const carMoves = parsed.assetChanges.filter((change) => /^(car|auto|macchina)$/i.test(change.to) && change.date < netto.firstDay);
  if (!carMoves.length) return { applies: false, moves: [] };
  const assets = netto.accounts.filter((account) => account.kind === "asset");
  const good = parsed.summary.materialGoods.find((item) => assets.some((account) => account.name.toLowerCase() === item.name.toLowerCase()))
    ?? (assets.length === 1 && parsed.summary.materialGoods.filter((item) => item.startOfYear).length === 1 ? parsed.summary.materialGoods.find((item) => item.startOfYear) : null);
  const account = good && (assets.find((candidate) => candidate.name.toLowerCase() === good.name.toLowerCase()) ?? assets[0]);
  const moved = carMoves.reduce((sum, move) => sum + move.amount, 0);
  const why = (reason) => ({ applies: false, moves: carMoves, reason });
  if (!account) return why("no car account in netto to match it with");
  const hasOwnTransactions = db.prepare(`SELECT 1 FROM transactions WHERE from_account_id = ? OR to_account_id = ? LIMIT 1`).get(account.id, account.id);
  if (hasOwnTransactions) return why(`${account.name} already has transactions in netto`);
  if (good.startOfYear + moved !== account.opening_balance) {
    return why(`the old tracker's ${good.name} (${good.startOfYear / 100} € + ${moved / 100} € moved to it) doesn't add up to netto's opening ${account.opening_balance / 100} €`);
  }
  return { applies: true, account, startOfYear: good.startOfYear, moves: carMoves, monthIndex: firstDayMonthIndex };
}

// ---------- the ETFs ----------

const KNOWN_FUND_NAMES = { "MSCI WORLD": "SWDA.MI", "MSCI EM": "EIMI.MI" };

// Which ticker an ASSETS CHANGE line bought: by name, else the only ticker whose shares went up that month
function findTickerOfPurchase(change, investments) {
  const named = KNOWN_FUND_NAMES[change.to.toUpperCase()] ?? investments.find((investment) => investment.ticker.split(/[.-]/)[0] === change.to.toUpperCase())?.ticker;
  if (named) return named;
  const monthIndex = MONTH_NAMES.indexOf(change.month);
  const grew = investments.filter((investment) => {
    const before = monthIndex === 0 ? investment.sharesAtStartOfYear : investment.sharesByMonth[MONTH_NAMES[monthIndex - 1]];
    return investment.sharesByMonth[change.month] > before;
  });
  return grew.length === 1 ? grew[0].ticker : null;
}

// Per ticker: the opening position on 1 Jan and the purchases of the year, when they lead exactly to netto's
// opening position; otherwise why not
function planInvestments(parsed, netto, firstDayMonthIndex) {
  const purchases = parsed.assetChanges
    .filter((change) => !/^(car|auto|macchina)$/i.test(change.to) && change.date < netto.firstDay)
    .map((change) => ({ ...change, ticker: findTickerOfPurchase(change, parsed.investments) }));
  const plans = [];
  const tickers = [...new Set([...parsed.investments.map((investment) => investment.ticker), ...purchases.map((purchase) => purchase.ticker).filter(Boolean)])];
  for (const ticker of tickers) {
    const old = parsed.investments.find((investment) => investment.ticker === ticker);
    const ownPurchases = purchases.filter((purchase) => purchase.ticker === ticker).sort((first, second) => first.date.localeCompare(second.date));
    const nettoTrades = netto.trades.filter((trade) => trade.ticker === ticker);
    const skip = (reason) => plans.push({ ticker, applies: false, reason, purchases: ownPurchases });
    if (!old) { skip("not in the old tracker's INV sheet"); continue; }
    const sharesBeforeNetto = firstDayMonthIndex > 0 ? old.sharesByMonth[MONTH_NAMES[firstDayMonthIndex - 1]] : old.sharesAtStartOfYear;
    const opening = nettoTrades.find((trade) => trade.side === "buy" && trade.account_id === null && (trade.note ?? "").startsWith(OPENING_POSITION_NOTE_START) && trade.date >= netto.firstDay);
    if (!opening) {
      skip(nettoTrades.length ? "netto has its own trades for it, not an opening position to rebuild" : "not in netto");
      continue;
    }
    if (Math.abs(opening.shares - sharesBeforeNetto) > 1e-9) { skip(`netto starts with ${opening.shares} shares, the old tracker had ${sharesBeforeNetto}`); continue; }

    // the shares of each purchase: the month's increase, shared among that month's purchases by amount
    const bought = [];
    let sharesCounted = old.sharesAtStartOfYear ?? 0;
    for (const [monthIndex, month] of MONTH_NAMES.entries()) {
      const inMonth = ownPurchases.filter((purchase) => purchase.month === month);
      if (!inMonth.length) continue;
      const before = monthIndex === 0 ? old.sharesAtStartOfYear : old.sharesByMonth[MONTH_NAMES[monthIndex - 1]];
      const increase = old.sharesByMonth[month] - before;
      const monthTotal = inMonth.reduce((sum, purchase) => sum + purchase.amount, 0);
      const wholeShares = Number.isInteger(increase);
      let given = 0, amountSoFar = 0;
      for (const purchase of inMonth) {
        amountSoFar += purchase.amount;
        const upToHere = increase * amountSoFar / monthTotal;
        const shares = (wholeShares ? Math.round(upToHere) : Number(upToHere.toFixed(8))) - given;
        given += shares;
        bought.push({ ...purchase, shares });
      }
      sharesCounted += increase;
    }
    if (bought.some((purchase) => !(purchase.shares > 0))) { skip("the shares bought can't be told apart from the purchases"); continue; }
    if (Math.abs(sharesCounted - opening.shares) > 1e-9) { skip(`start + purchases = ${sharesCounted} shares, netto has ${opening.shares}`); continue; }

    // the cost stays netto's: the opening position on 1 Jan takes the difference, or with none, the last purchase
    const purchasesCost = bought.reduce((sum, purchase) => sum + purchase.amount, 0);
    const openingShares = old.sharesAtStartOfYear ?? 0;
    let openingAmount = opening.amount - purchasesCost;
    let costNote = null;
    if (openingShares > 0 && openingAmount <= 0) { skip("the purchases cost more than netto's whole position"); continue; }
    if (openingShares === 0 && openingAmount !== 0) {
      const last = bought.at(-1);
      if (last.amount + openingAmount <= 0) { skip("the purchases don't match netto's cost"); continue; }
      costNote = `last purchase ${openingAmount > 0 ? "+" : ""}${(openingAmount / 100).toFixed(2).replace(".", ",")} € so the cost stays netto's`;
      last.amount += openingAmount;
      openingAmount = 0;
    }
    plans.push({ ticker, applies: true, replacesTradeId: opening.id, openingShares, openingAmount, purchases: bought, cost: opening.amount, costNote });
  }
  return plans;
}

// ---------- the plan (the preview) ----------

// options.excluded: keys of flagged lines to leave out (the preview's tick boxes)
function buildImportPlan(parsed, options = {}) {
  const excluded = new Set(options.excluded ?? []);
  const netto = readNetto();
  const blockers = [];
  if (!netto.firstDay) blockers.push("netto has no accounts yet: add them first, as they are today");
  if (netto.accounts.some((account) => account.name.toLowerCase() === HISTORY_ACCOUNT_NAME.toLowerCase())) {
    blockers.push(`there is already an "${HISTORY_ACCOUNT_NAME}" account: the history was imported before`);
  }
  if (netto.firstTransactionDay && netto.firstDay && netto.firstTransactionDay < netto.firstDay) {
    blockers.push("netto already has transactions before its first account was opened");
  }
  if (parsed.summary.cashAtStartOfYear === null) blockers.push("the old tracker's \"Cash - Liquidity\" at the start of the year wasn't found");
  const firstDay = netto.firstDay ?? `${parsed.year}-12-31`;
  const firstDayMonthIndex = Number(firstDay.slice(5, 7)) - 1;

  // every line, classified
  const lines = [];
  const skippedAfterStart = [];
  for (const month of parsed.months) {
    for (const line of month.transactions) {
      if (line.date >= firstDay) { skippedAfterStart.push(line); continue; }
      lines.push({ ...line, old_category: line.category === "Income" ? line.incomeCategory || "Income" : line.category, ...classifyLine(line), excluded: excluded.has(line.key) });
    }
  }
  const included = lines.filter((line) => !line.excluded);

  // the old tracker's own monthly totals: does every line add up?
  const totalChecks = parsed.months.filter((month) => month.transactions.length).map((month) => {
    const byLabel = new Map();
    for (const line of month.transactions) {
      const label = line.category === "Income" ? "Income" : EXPENSE_CATEGORIES[line.category]?.totalLabel ?? line.category;
      byLabel.set(label, (byLabel.get(label) ?? 0) + line.amount);
    }
    const spending = month.transactions.filter((line) => line.category !== "Income").reduce((sum, line) => sum + line.amount, 0);
    const differences = [...byLabel].filter(([label, total]) => month.totals[label] !== undefined && month.totals[label] !== total)
      .map(([label, total]) => ({ label, lines: total, sheet: month.totals[label] }));
    if (month.totals["TOT SPE MEN"] !== undefined && month.totals["TOT SPE MEN"] !== spending) differences.push({ label: "TOT SPE MEN", lines: spending, sheet: month.totals["TOT SPE MEN"] });
    return { month: month.month, differences };
  });

  // categories to create
  const needed = new Map();
  for (const line of included) {
    if (line.type === "adjustment") continue;
    const kind = line.type === "income" ? "income" : "expense";
    if (!findCategory(netto.categories, line.category, kind)) needed.set(`${kind}:${line.category}`, { name: line.category, kind, spending_pace: NEW_CATEGORY_PACE[line.category] ?? (kind === "income" ? "daily" : "occasional") });
  }

  const car = netto.firstDay ? planCar(parsed, netto, firstDayMonthIndex) : { applies: false, moves: [] };
  const investments = netto.firstDay ? planInvestments(parsed, netto, firstDayMonthIndex) : [];

  // the "Old tracker" account, day by day
  const opening = parsed.summary.cashAtStartOfYear ?? 0;
  const flows = included.reduce((sum, line) => sum + (line.type === "income" || line.direction === "in" ? line.amount : -line.amount), 0);
  const investedFromIt = investments.filter((plan) => plan.applies).flatMap((plan) => plan.purchases).reduce((sum, purchase) => sum + purchase.amount, 0);
  const movedToCar = car.applies ? car.moves.reduce((sum, move) => sum + move.amount, 0) : 0;
  const beforeHandOver = opening + flows - investedFromIt - movedToCar;
  const handOvers = netto.accounts
    .filter((account) => account.kind !== "asset" && account.opening_balance !== 0)
    .map((account) => ({ account_id: account.id, name: account.name, amount: account.opening_balance, date: account.open_date }));
  const handedOver = handOvers.reduce((sum, handOver) => sum + handOver.amount, 0);
  const difference = handedOver - beforeHandOver; // > 0: netto started with more than the old tracker had
  // the recounts of netto's first month: often the same gap, found again account by account
  const recountRows = netto.firstDay ? db.prepare(`
    SELECT CASE WHEN t.to_account_id IS NOT NULL THEN t.amount ELSE -t.amount END AS amount, a.name
    FROM transactions t JOIN accounts a ON a.id = COALESCE(t.to_account_id, t.from_account_id)
    WHERE t.type = 'adjustment' AND t.date BETWEEN ? AND date(?, '+31 days')`).all(netto.firstDay, netto.firstDay) : [];
  const laterRecounts = recountRows.reduce((sum, row) => sum + row.amount, 0);
  const laterRecountAccounts = [...new Set(recountRows.map((row) => row.name))];

  const count = (type) => included.filter((line) => line.type === type).length;
  return {
    canImport: blockers.length === 0 && included.length > 0,
    blockers,
    year: parsed.year,
    first_netto_day: firstDay,
    period: { from: lines.length ? lines.map((line) => line.date).sort()[0] : null, to: lines.length ? lines.map((line) => line.date).sort().at(-1) : null },
    counts: { expense: count("expense"), income: count("income"), adjustment: count("adjustment"), excluded: lines.length - included.length, after_netto_start: skippedAfterStart.length },
    total_checks: totalChecks,
    new_categories: [...needed.values()],
    lines, // every line, with what it becomes
    history_account: {
      name: HISTORY_ACCOUNT_NAME, opens: `${parsed.year}-01-01`, opening,
      income: included.filter((line) => line.type === "income").reduce((sum, line) => sum + line.amount, 0),
      spending: included.filter((line) => line.type === "expense").reduce((sum, line) => sum + line.amount, 0),
      adjustments: included.filter((line) => line.type === "adjustment").reduce((sum, line) => sum + (line.direction === "in" ? line.amount : -line.amount), 0),
      invested: investedFromIt, moved_to_car: movedToCar, before_hand_over: beforeHandOver,
      difference, later_recounts: laterRecounts, later_recount_accounts: laterRecountAccounts, hand_overs: handOvers,
      closes: handOvers.length ? handOvers.map((handOver) => handOver.date).sort().at(-1) : firstDay,
    },
    car: car.applies
      ? { applies: true, account: car.account.name, account_id: car.account.id, start_of_year: car.startOfYear, moves: car.moves }
      : { applies: false, reason: car.reason ?? null, moves: car.moves },
    investments,
  };
}

// ---------- saving it ----------

// Everything in one database transaction: if anything doesn't add up at the end, nothing is saved
function applyImportPlan(plan) {
  if (!plan.canImport) throw new Error(plan.blockers[0] ?? "nothing to import");
  const balancesBefore = new Map(db.prepare(`SELECT id, balance FROM accounts`).all().map((account) => [account.id, account.balance]));
  const sharesBefore = new Map(db.prepare(`SELECT ticker, shares, amount_invested FROM investments`).all().map((row) => [row.ticker, row]));

  db.transaction(() => {
    // categories
    for (const category of plan.new_categories) {
      db.prepare(`INSERT INTO categories (name, kind, spending_pace) VALUES (?, ?, ?)`).run(category.name, category.kind, category.spending_pace);
    }
    const categories = db.prepare(`SELECT id, name, kind FROM categories`).all();
    const categoryId = (name, kind) => findCategory(categories, name, kind).id;

    // the "Old tracker" account and its history
    const history = plan.history_account;
    // 'cash': a spreadsheet isn't a bank account, so no imposta di bollo is estimated on it (Statements)
    const historyId = db.prepare(`INSERT INTO accounts (name, kind, opening_balance, balance, open_date) VALUES (?, 'cash', ?, ?, ?)`)
      .run(history.name, history.opening, history.opening, history.opens).lastInsertRowid;
    const insertTransaction = db.prepare(`
      INSERT INTO transactions (from_account_id, to_account_id, type, amount, category_id, description, date)
      VALUES (@from, @to, @type, @amount, @category, @description, @date)`);
    for (const line of plan.lines.filter((candidate) => !candidate.excluded)) {
      const moneyIn = line.type === "income" || line.direction === "in";
      insertTransaction.run({
        from: moneyIn ? null : historyId, to: moneyIn ? historyId : null, type: line.type, amount: line.amount,
        category: line.type === "adjustment" ? null : categoryId(line.category, line.type === "income" ? "income" : "expense"),
        description: line.description || null, date: line.date,
      });
    }

    // the car: opens on 1 Jan at its old value, then receives what was moved to it
    if (plan.car.applies) {
      const account = db.prepare(`SELECT opening_balance FROM accounts WHERE id = ?`).get(plan.car.account_id);
      db.prepare(`UPDATE accounts SET opening_balance = ?, balance = balance - ?, open_date = ? WHERE id = ?`)
        .run(plan.car.start_of_year, account.opening_balance - plan.car.start_of_year, history.opens, plan.car.account_id);
      for (const move of plan.car.moves) {
        insertTransaction.run({ from: historyId, to: plan.car.account_id, type: "movement", amount: move.amount, category: null, description: "Money put into the car (old tracker)", date: move.date });
      }
    }

    // the ETFs: the opening position becomes 1 Jan + the purchases of the year, paid from "Old tracker"
    const insertTrade = db.prepare(`
      INSERT INTO investment_trades (ticker, side, date, shares, amount, fees, account_id, transaction_id, note)
      VALUES (?, 'buy', ?, ?, ?, 0, ?, ?, ?)`);
    for (const investment of plan.investments.filter((candidate) => candidate.applies)) {
      db.prepare(`DELETE FROM investment_trades WHERE id = ?`).run(investment.replacesTradeId);
      if (investment.openingShares > 0) {
        insertTrade.run(investment.ticker, history.opens, investment.openingShares, investment.openingAmount, null, null, "Opening position (bought before trades were recorded)");
      }
      for (const purchase of investment.purchases) {
        const trade = { side: "buy", ticker: investment.ticker, shares: purchase.shares, amount: purchase.amount, date: purchase.date, accountId: historyId };
        const cashTransactionId = syncCashTransactionOfTrade(trade, null);
        insertTrade.run(investment.ticker, purchase.date, purchase.shares, purchase.amount, historyId, cashTransactionId, "From the old tracker");
      }
      rebuildHoldingFromTrades(investment.ticker);
    }

    // netto's first day: the difference between the trackers, then each account's opening balance handed over
    if (history.difference !== 0) {
      insertTransaction.run({
        from: history.difference < 0 ? historyId : null, to: history.difference > 0 ? historyId : null, type: "adjustment",
        amount: Math.abs(history.difference), category: null, date: plan.first_netto_day,
        description: "Recount: difference between the old tracker and netto's opening balances",
      });
    }
    for (const handOver of history.hand_overs) {
      db.prepare(`UPDATE accounts SET opening_balance = 0, balance = balance - ? WHERE id = ?`).run(handOver.amount, handOver.account_id);
      insertTransaction.run({
        from: handOver.amount > 0 ? historyId : handOver.account_id, to: handOver.amount > 0 ? handOver.account_id : historyId,
        type: "movement", amount: Math.abs(handOver.amount), category: null, date: handOver.date,
        description: "Opening balance, handed over from the old tracker",
      });
    }
    db.prepare(`UPDATE accounts SET closed_at = ? WHERE id = ?`).run(history.closes, historyId);

    // the promise: every account as it was, "Old tracker" at 0, the same shares and cost
    const historyBalance = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(historyId).balance;
    if (historyBalance !== 0) throw new Error(`"${history.name}" would end at ${historyBalance / 100} € instead of 0: nothing was imported`);
    for (const [id, balance] of balancesBefore) {
      const now = db.prepare(`SELECT balance, name FROM accounts WHERE id = ?`).get(id);
      if (now.balance !== balance) throw new Error(`${now.name}'s balance would change: nothing was imported`);
    }
    for (const [ticker, before] of sharesBefore) {
      const now = db.prepare(`SELECT shares, amount_invested FROM investments WHERE ticker = ?`).get(ticker);
      if (!now || Math.abs(now.shares - before.shares) > 1e-9 || now.amount_invested !== before.amount_invested) {
        throw new Error(`${ticker} would change: nothing was imported`);
      }
    }
  })();
}

module.exports = { buildImportPlan, applyImportPlan, classifyLine, HISTORY_ACCOUNT_NAME };
