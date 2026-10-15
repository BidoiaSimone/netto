# netto — code map

Where everything lives, and why. Every file starts with a comment saying what it does, so this page
only gives the big picture.

## How a request flows

```
browser (frontend/JS)                      server (backend/server)                     database (backend/db)
───────────────────────                    ───────────────────────                     ─────────────────────
dialogs/transactionDialog.js  ── POST /transactions ──▶  routes/transactionRoutes.js
                                                           │ validation/transactionValidation.js  (is it valid? euros → cents)
                                                           ▼
                                                          INSERT INTO transactions  ──▶  triggers update accounts.balance
core/dataRefresh.js  ◀── every page reloads its data ──  (GET /accounts, /transactions, …)
```

- **routes/** only deal with HTTP: read the request, call validation or a service, send the answer.
- **validation/** checks what the frontend sent and turns it into database values (cents, ids).
- **services/** hold the logic that isn't about HTTP: holdings from trades, backups, market prices, net worth.
- **utils/** are small helpers with no knowledge of the app (money conversion, dates, errors).

Money is integer **cents** in the database and **euros** in the API. The conversion happens only in
`backend/server/utils/moneyConversion.js`.

## Backend

```
backend/
├── config/
│   ├── accountKinds.js              account kinds and their liquidity class (cash, restricted, personal-use)
│   ├── italianTaxRates.js           Italian tax rates for the Statements estimates, each with its source and date
│   ├── projectPaths.js              every folder / file the backend uses (frontend, money.db, backups);
│   │                                NETTO_DATABASE_FILE / NETTO_BACKUPS_DIRECTORY move them (the tests do)
│   └── serverSettings.js            port, host, AUTO_EXIT, request size
├── db/
│   ├── databaseConnection.js        opens money.db (everyone requires this), runs migrations, checks balances
│   ├── balanceIntegrityCheck.js     warns at startup if a stored balance doesn't match its transactions
│   ├── firstRecordedDate.js         date given to "opening position" trades
│   ├── migrations/
│   │   ├── migrationRunner.js       runs the migrations the database hasn't had yet (PRAGMA user_version)
│   │   ├── allMigrationsInOrder.js  the list; position = migration number
│   │   └── 001-…js … 012-…js        one file per schema change, never edited once applied (010: tags, 011: budgets, 012: forecast)
│   ├── tools/
│   │   ├── printDatabaseTables.js   npm run db:print
│   │   └── clearDatabase.js         npm run db:clear -- --yes   (deletes everything!)
│   ├── money.db                     your data
│   └── backups/                     automatic, pre-migration, pre-import and JSON backups
└── server/
    ├── app.js                       puts the pieces together and starts listening (npm start)
    ├── middleware/
    │   └── rejectRequestsFromOtherHosts.js   DNS-rebinding protection
    ├── appWindow/
    │   ├── openWindowSessions.js    /session: knows which windows are open, stops the server when none are
    │   └── frontendLiveReload.js    reloads the page when a frontend file is saved
    ├── routes/
    │   ├── apiRouter.js             mounts every route file below (order matters for /investments)
    │   ├── accountRoutes.js         /accounts  (+ close, reopen, reconcile)
    │   ├── transactionRoutes.js     /transactions
    │   ├── recurringTransactionRoutes.js /recurring-transactions (rules: add, edit, pause, delete)
    │   ├── categoryRoutes.js        /categories: income and expense ones (rename / merge / move)
    │   ├── tagRoutes.js             /tags (add / rename or merge / dates / delete), /tags/report
    │   ├── budgetRoutes.js          PUT /categories/:id/budget, GET /budgets/this-month
    │   ├── forecastRoutes.js        /forecast, and its plan: /forecast/phases, /forecast/events, /forecast/assumptions
    │   ├── investmentTradeRoutes.js /investments/trades
    │   ├── investmentHoldingRoutes.js /investments, /investments/history, /investments/:ticker
    │   ├── netWorthRoutes.js        /net-worth, /net-worth/history
    │   ├── statementRoutes.js       /statements?from=&to= (Statements page; a period starts no earlier than the first record)
    │   ├── todoRoutes.js            /todos (Next up page)
    │   ├── backupRoutes.js          /backups, /backups/open, /export, /import
    │   └── databaseDumpRoutes.js    /database (debug)
    ├── validation/
    │   ├── accountValidation.js
    │   ├── transactionValidation.js
    │   ├── tagValidation.js         a tag (name, trip dates) and the tags sent with a transaction
    │   ├── forecastValidation.js    a phase, a one-off event, the assumptions (with the sliders' ranges)
    │   ├── recurringTransactionValidation.js
    │   └── tradeValidation.js       also checks a new ticker exists on Yahoo
    ├── services/
    │   ├── holdingsCalculator.js    replays trades → shares, cost, realized gains (average cost)
    │   ├── tradeCashTransactions.js keeps a trade's cash transaction in step with the trade
    │   ├── transactionTags.js       saves a transaction's tags (creating typed new ones), lists every transaction's tags
    │   ├── tagReport.js             per tag: spent, received, net, count, dates, spending by category
    │   ├── budgetCalculator.js      limit in effect each month; this month's progress + projection; budget vs actual (prorated)
    │   ├── recurrenceSchedule.js    dates of a recurring rule (every N weeks / months / years)
    │   ├── recurringTransactionPoster.js adds the due recurring transactions (at start, after changes, each new day)
    │   ├── holdingValuation.js      holding rows → API shape, + live value
    │   ├── investmentPriceHistory.js price history for the chart (cached 15 min)
    │   ├── netWorthCalculator.js    accounts + investments at today's prices
    │   ├── netWorthHistory.js       net worth on every day of a period, rebuilt from transactions + trades
    │   ├── financialStatements.js   income statement, balance sheet, net worth bridge, budget vs actual, returns and tax estimates of a period
    │   ├── rateOfReturn.js          the maths only: XIRR (Newton + bisection), money- and time-weighted returns
    │   ├── investmentReturns.js     a period's returns per ticker and in total, from the trades and daily values
    │   ├── italianTaxEstimates.js   deferred tax, imposta di bollo, capital gains tax: estimates, never inside the totals
    │   ├── forecastSimulation.js    the maths only: the month-by-month simulation, runway
    │   ├── forecast.js              the Forecast page's data: start values, history, real averages, band, key numbers
    │   ├── yahooFinanceMarketData.js prices and history from Yahoo, converted to EUR
    │   ├── automaticDailyBackups.js one copy of money.db per day, last 14 kept
    │   ├── backupsFolder.js         JSON copy, pre-import copy, open in Finder
    │   ├── jsonBackupExport.js      builds the "Download backup (JSON)" file
    │   └── jsonBackupImport.js      restores one (also old formats), all or nothing
    └── utils/
        ├── moneyConversion.js       convertEurosToCents / convertCentsToEuros
        ├── localDates.js            today as YYYY-MM-DD, date parsing
        └── httpErrors.js            errors that carry their HTTP status
```

**Tags** (migration 10) group transactions across categories, e.g. a trip. `tags` holds the tags (name, optional
dates); `transaction_tags` links them to transactions, one row per pair, by id. A transaction's tags travel with it:
POST / PUT /transactions take `tag_ids` (existing) and `new_tag_names` (typed in the dialog, created in the same
database transaction), and GET /transactions returns `tags: [{ id, name }]`. Recurring rules have no tags.

**Budgets** (migration 11) are monthly limits per expense category, with history: each row of `category_budgets`
says "from this month on, the limit is X" (NULL = no budget), and a month's limit is the newest row on or before it,
so changing a budget never rewrites how past months are judged. `services/budgetCalculator.js` does all the maths:
this month's progress and projection for Insights, and budget vs actual for Statements (each month's limit × the
share of that month in the period, so partial months are prorated by days).

**Returns and taxes** (Statements). `rateOfReturn.js` is pure maths (tested against Excel's XIRR);
`investmentReturns.js` feeds it the period's values and trades. `italianTaxEstimates.js` uses the rates in
`config/italianTaxRates.js`; its results are shown next to the statements and never added to any total, so the
bridge keeps adding up to the cent. Check the rates (and their date) when a new budget law comes out.

**Forecast** (migration 12): the plan is a list of phases (each only says the month it starts, so they can't
overlap), one-off events and one row of assumptions. `forecastSimulation.js` steps forward month by month (returns,
depreciation, the phase's income − expenses raised with inflation, events, investments sold when cash runs out);
`forecast.js` gives it today's real values and adds the history, the 0%/8% band and the key numbers.

The tests live in `tests/` (see **Tests** below).

## Frontend

`frontend/HTML/Home.html` is the only page. Each sidebar entry is a `<section data-page="…">` in it.
It loads `JS/themeBeforeFirstPaint.js` (a normal script, so the theme is set before anything is drawn)
and `JS/main.js` as an **ES module**: every other JS file is reached through `import` statements, so
each file says at the top exactly what it uses and where it comes from.

```
frontend/JS/
├── main.js                          connects every feature, then loads the data (start reading here)
├── themeBeforeFirstPaint.js
├── core/                            shared by everything
│   ├── apiClient.js                 callApi(): fetch + error handling
│   ├── appState.js                  data shared by several pages (accounts, transactions, …)
│   ├── dataRefresh.js               loadAllData(), runThenReloadAllData()
│   ├── domHelpers.js                elementById, createElement, fillTableBody, …
│   ├── formatting.js                euro / share / date formats, animated amounts
│   ├── accountPickers.js            the account dropdowns
│   ├── accountKinds.js              account kind labels and liquidity classes (same list as backend/config)
│   ├── netWorthGroups.js            Home's 3 groups: liquid (cash + vouchers), investments, immobilized (car); bar widths
│   ├── categoryPickers.js           the category dropdowns (only the kind the transaction type uses)
│   ├── transactionDisplay.js        the coloured +/− amount cell, the ↻ for recurring ones
│   ├── recurrenceDates.js           next dates and "Every month on the 5th" (same maths as the server)
│   └── errorBanner.js               the red line at the top
├── app/                             the page frame
│   ├── pageNavigation.js            #hash → which section is shown
│   ├── dialogWindows.js             openDialog(), data-open / data-close buttons
│   ├── keyboardShortcuts.js         N and P
│   └── serverSession.js             /session connection + live reload
├── pages/                           one file per sidebar page
│   ├── homePage.js                  net worth + liquid / investments / immobilized cards and bar, latest transactions
│   ├── assetsPage.js  + assetsPieChart.js
│   ├── transactionsPage.js          list + filters
│   ├── recurringPage.js             recurring transactions and what they add up to per month
│   ├── categoriesPage.js  + tagManagement.js (the Tags list under the categories; loads the tags for everyone)
│   │                       (expense categories also have their monthly budget field here)
│   ├── investmentsPage.js  + investmentPriceHistoryChart.js
│   ├── insightsPage.js  + netWorthHistoryChart.js + liquidityInsights.js + monthProjection.js + tagInsights.js
│   │                       + budgetProgress.js (This month > Budgets: a bar per budgeted category)
│   ├── forecastPage.js              key numbers, warnings, the real + forecast chart  + forecastPlanEditor.js (phases, events, sliders)
│   ├── statementsPage.js            bridge, investment returns, income statement + estimated taxes, budget vs actual, balance sheet (+ after tax)
│   └── nextUpPage.js
├── dialogs/                         add / edit windows
│   ├── transactionDialog.js  + transactionTagPicker.js (the Tags field: chips, Enter to add, date suggestions)
│   ├── accountDialog.js
│   ├── tradeDialog.js
│   ├── recurringTransactionDialog.js
│   └── reconcileDialog.js
├── charts/                          drawing only, no app data
│   ├── lineChart.js
│   ├── stackedAreaChart.js          (optional: a lighter forecast part after "today", and a band)
│   ├── chartAxis.js             value axis, date labels, tooltip placement (shared)
│   ├── horizontalBarChart.js
│   ├── waterfallChart.js            the Statements page's net worth bridge
│   └── svgHelpers.js
└── settings/                        Settings page and the preferences it controls
    ├── themeAndAccentColor.js
    ├── privacyMode.js
    ├── autoRefresh.js
    └── backupSettings.js
```

`frontend/CSS/` is split the same way into numbered files (`01-theme-colors.css` … `21-home-net-worth-groups.css`).
Home.html loads them in number order; the order matters because a later rule wins over an earlier one
with the same specificity.

## Tests

```
npm test
```

runs every `tests/*.test.js` file with Node's built-in test runner (`node --test`, no extra packages)
and prints `ok` / `not ok` for each test, then the totals. The whole suite takes a few seconds.

**Your data is never touched.** Before anything from `backend/` is loaded, `tests/helpers/testEnvironment.js`
sets `NETTO_DATABASE_FILE=:memory:` (a database that only exists in RAM, built by the migrations and gone when
the test ends) and points `NETTO_BACKUPS_DIRECTORY` at a temporary folder. It also stops if the database it
got isn't the in-memory one. Each test file runs in its own process, so each starts from an empty database.

**No internet.** Yahoo Finance is replaced by `tests/helpers/fakeYahooFinanceMarketData.js`: fixed current
prices for VWCE.MI and AAPL, and a made-up daily price history. Any other ticker behaves like an unknown one.

```
tests/
├── helpers/
│   ├── testEnvironment.js              require FIRST: in-memory database, temp backups folder, fake Yahoo
│   ├── fakeYahooFinanceMarketData.js   fixed prices and price history
│   ├── testServer.js                   the real API router on a free port; callApi(method, path, body)
│   ├── fakeDataset.js                  buildFakeDataset(): accounts of every kind, categories, ~21 months of
│   │                                   transactions, a reconciliation, a recurring rule, trades on 2 tickers,
│   │                                   a tagged trip ("Lisbon 2025")
│   └── balanceRule.js                  stored balance = opening + in − out, checked in SQL and in JavaScript
├── migrations.test.js                  empty and version-0 databases reach the latest version, data intact
├── balances.test.js                    add / edit / delete every kind of transaction: balances stay right
├── validation.test.js                  category kinds, closed accounts, euros → cents (1.005 → 101), refusals
├── categories.test.js                  rename, merge, move to the other kind (and when it's blocked)
├── tags.test.js                        migration 10, a transaction's tags, rename / merge / delete, totals, JSON backups
├── budgets.test.js                     migration 11, setting limits (history), partial months, projection, budget vs actual
├── investmentReturns.test.js           XIRR vs Excel, edge cases, TWR vs MWR, returns on the dataset (TWR checked day by day)
├── italianTaxes.test.js                deferred tax (no offsetting), bollo (prorated, 5,000 € threshold), capital gains tax
├── forecast.test.js                    straight line, compound interest, annuity, inflation, phases, events, shortfall, averages, API
├── statements.test.js                  bridge.unexplained = 0 and balance sheet = bridge, on fixed and random periods
├── liquidity.test.js                   /net-worth by_liquidity adds up to net_worth
└── homeNetWorthGroups.test.js          Home's liquid + investments + immobilized = net worth, the car only in immobilized, bar = 100%
```

**Adding a test.** Put it in the file of its area, or create `tests/<area>.test.js` (the `.test.js` ending is
what `npm test` looks for). A new file starts like the existing ones:

```js
const { openTestDatabase } = require("./helpers/testEnvironment.js"); // ALWAYS the first line
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/testServer.js");
const { buildFakeDataset } = require("./helpers/fakeDataset.js");

const db = openTestDatabase();
let callApi, stopServer, dataset;
before(async () => {
  ({ callApi, stopServer } = await startTestServer());
  dataset = await buildFakeDataset(callApi, db);   // dataset.accountIds.cash, dataset.categoryIds.rent, …
});
after(() => stopServer());

test("what should be true, in a sentence", async () => {
  const { status, body } = await callApi("POST", "/transactions", { type: "expense", amount: 5, from_account_id: dataset.accountIds.cash });
  assert.equal(status, 201);
});
```

`testEnvironment.js` must come first because `databaseConnection.js` opens the database the moment it is
required: anything from `backend/` loaded earlier would open the real money.db. To run one file only:
`node --test tests/statements.test.js`. The random periods in `statements.test.js` use a fixed seed, so a
failure there happens again on the next run and can be investigated.

## Naming conventions

- Names say what a thing is or does in full: `convertEurosToCents`, `rebuildHoldingFromTrades`,
  `countedAmountByAccountName`. No one-letter variables outside of very short arrow functions.
- Functions are verbs (`loadAccounts`, `renderAssetsPage`, `openTradeDialog`); data is nouns.
- `load…` fetches from the server, `render…` / `draw…` updates the page from data already loaded,
  `initialize…` connects buttons and forms once at startup.
- Backend files: `…Routes.js` (HTTP), `…Validation.js`, services named after what they compute.
- Accounts and categories are always identified by **id**, never by name, in the database and on the
  pages (dropdown values, filters, reconcile inputs...): renaming one can't break anything.
- The HTML element ids (`tx-form`, `inv-gain`, …) and the API's JSON field names are unchanged, so the
  HTML and any saved JSON backups keep working.

## Where the old files went

| Before | After |
|---|---|
| `backend/server/app.js` (everything) | `app.js` + `config/` + `middleware/` + `appWindow/` |
| `backend/server/routes/routes.js` | `routes/apiRouter.js` |
| `routes/accounts.js` | `routes/accountRoutes.js` + `validation/accountValidation.js` |
| `routes/transactions.js` | `routes/transactionRoutes.js` + `validation/transactionValidation.js` |
| `routes/categories.js` | `routes/categoryRoutes.js` |
| `routes/investments.js` | `routes/investmentTradeRoutes.js`, `routes/investmentHoldingRoutes.js`, `validation/tradeValidation.js`, `services/tradeCashTransactions.js`, `services/holdingValuation.js`, `services/investmentPriceHistory.js` |
| `routes/analytics.js` | `routes/netWorthRoutes.js` + `services/netWorthCalculator.js` |
| `routes/todos.js` | `routes/todoRoutes.js` |
| `routes/databaseQueries.js` | `routes/backupRoutes.js`, `routes/databaseDumpRoutes.js`, `services/jsonBackupExport.js`, `services/jsonBackupImport.js` |
| `services/market.js` | `services/yahooFinanceMarketData.js` |
| `holdings.js` | `services/holdingsCalculator.js` |
| `backups.js` | `services/automaticDailyBackups.js` + `services/backupsFolder.js` |
| `money.js`, `dates.js` | `utils/moneyConversion.js`, `utils/localDates.js` |
| `backend/db/database.js` | `db/databaseConnection.js` |
| `backend/db/schema.js` | `db/migrations/` (runner + one file per migration), `db/balanceIntegrityCheck.js`, `db/firstRecordedDate.js` |
| `backend/db/clear-db.js`, `test-db.js` | `db/tools/clearDatabase.js`, `db/tools/printDatabaseTables.js` |
| `frontend/JS/home.js` | `frontend/JS/**` (see above) |
| `frontend/CSS/stylesheet.css` | `frontend/CSS/01-…css` … `12-…css` (same rules, same order) |

The refactor itself didn't change the database (same tables, same migrations, only their function names
were renamed). Since then, migration 7 added recurring transactions, migration 10 tags, migration 11 budgets and migration 12 the forecast plan.
