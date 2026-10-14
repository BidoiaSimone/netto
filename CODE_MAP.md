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
│   ├── projectPaths.js              every folder / file the backend uses (frontend, money.db, backups)
│   └── serverSettings.js            port, host, AUTO_EXIT, request size
├── db/
│   ├── databaseConnection.js        opens money.db (everyone requires this), runs migrations, checks balances
│   ├── balanceIntegrityCheck.js     warns at startup if a stored balance doesn't match its transactions
│   ├── firstRecordedDate.js         date given to "opening position" trades
│   ├── migrations/
│   │   ├── migrationRunner.js       runs the migrations the database hasn't had yet (PRAGMA user_version)
│   │   ├── allMigrationsInOrder.js  the list; position = migration number
│   │   └── 001-…js … 009-…js        one file per schema change, never edited once applied
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
    │   ├── investmentTradeRoutes.js /investments/trades
    │   ├── investmentHoldingRoutes.js /investments, /investments/history, /investments/:ticker
    │   ├── netWorthRoutes.js        /net-worth, /net-worth/history
    │   ├── statementRoutes.js       /statements?from=&to= (Statements page)
    │   ├── todoRoutes.js            /todos (Next up page)
    │   ├── backupRoutes.js          /backups, /backups/open, /export, /import
    │   └── databaseDumpRoutes.js    /database (debug)
    ├── validation/
    │   ├── accountValidation.js
    │   ├── transactionValidation.js
    │   ├── recurringTransactionValidation.js
    │   └── tradeValidation.js       also checks a new ticker exists on Yahoo
    ├── services/
    │   ├── holdingsCalculator.js    replays trades → shares, cost, realized gains (average cost)
    │   ├── tradeCashTransactions.js keeps a trade's cash transaction in step with the trade
    │   ├── recurrenceSchedule.js    dates of a recurring rule (every N weeks / months / years)
    │   ├── recurringTransactionPoster.js adds the due recurring transactions (at start, after changes, each new day)
    │   ├── holdingValuation.js      holding rows → API shape, + live value
    │   ├── investmentPriceHistory.js price history for the chart (cached 15 min)
    │   ├── netWorthCalculator.js    accounts + investments at today's prices
    │   ├── netWorthHistory.js       net worth on every day of a period, rebuilt from transactions + trades
    │   ├── financialStatements.js   income statement, balance sheet and net worth bridge of a period
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
│   ├── homePage.js
│   ├── assetsPage.js  + assetsPieChart.js
│   ├── transactionsPage.js          list + filters
│   ├── recurringPage.js             recurring transactions and what they add up to per month
│   ├── categoriesPage.js
│   ├── investmentsPage.js  + investmentPriceHistoryChart.js
│   ├── insightsPage.js  + netWorthHistoryChart.js + liquidityInsights.js + monthProjection.js
│   ├── statementsPage.js            income statement, balance sheet, net worth bridge for a period
│   └── nextUpPage.js
├── dialogs/                         add / edit windows
│   ├── transactionDialog.js
│   ├── accountDialog.js
│   ├── tradeDialog.js
│   ├── recurringTransactionDialog.js
│   └── reconcileDialog.js
├── charts/                          drawing only, no app data
│   ├── lineChart.js
│   ├── stackedAreaChart.js
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

`frontend/CSS/` is split the same way into numbered files (`01-theme-colors.css` … `16-statements-page.css`).
Home.html loads them in number order; the order matters because a later rule wins over an earlier one
with the same specificity.

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
were renamed). Since then, migration 7 added recurring transactions.
