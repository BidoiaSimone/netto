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
│   ├── appSettings.js               the settings stored with your data (app_settings): defaults and allowed ranges
│   ├── currencies.js                the foreign currencies a transaction can be paid in, with their decimals (minor units)
│   ├── edition.js                   full netto or netto light (NETTO_EDITION=light): see "Two editions" below
│   ├── italianTaxRates.js           Italian tax rates for the Statements estimates, each with its source and date
│   ├── projectPaths.js              every folder / file the backend uses (frontend, money.db, backups);
│   │                                NETTO_DATABASE_FILE / NETTO_BACKUPS_DIRECTORY move them (the tests do);
│   │                                netto light defaults to light.db and light-backups/
│   └── serverSettings.js            port, host, AUTO_EXIT, request size
├── db/
│   ├── databaseConnection.js        opens money.db (everyone requires this), runs migrations, checks balances
│   ├── balanceIntegrityCheck.js     warns at startup if a stored balance doesn't match its transactions
│   ├── firstRecordedDate.js         date given to "opening position" trades
│   ├── migrations/
│   │   ├── migrationRunner.js       runs the migrations the database hasn't had yet (PRAGMA user_version)
│   │   ├── allMigrationsInOrder.js  the list; position = migration number
│   │   └── 001-…js … 022-…js        one file per schema change, never edited once applied (010: tags, 011: budgets, 012: forecast,
│   │                                013: forecast events linked to investments, 014: foreign currency, 015: investment targets + settings,
│   │                                016: spending pace of a category, daily / occasional, for the month projections,
│   │                                017: goals paid for by cutting back, 018: ids of transactions sent later by the phone,
│   │                                019: the imported "Old tracker" account is cash, not a bank account,
│   │                                020: the last price of each investment, for when Yahoo doesn't answer,
│   │                                021: each category's icon and colour, 022: income linked to a goal)
│   ├── tools/
│   │   ├── printDatabaseTables.js   npm run db:print
│   │   ├── clearDatabase.js         npm run db:clear -- --yes   (deletes everything!)
│   │   └── fillLightDemo.js         npm run light:demo: made-up months of data, only into an empty light.db
│   ├── money.db                     your data
│   └── backups/                     automatic, pre-migration, pre-import and JSON backups
└── server/
    ├── app.js                       puts the pieces together and starts listening (npm start)
    ├── middleware/
    │   └── rejectRequestsFromOtherHosts.js   DNS-rebinding protection
    ├── appWindow/
    │   ├── openWindowSessions.js    /session: knows which windows are open, stops the server when none are
    │   ├── frontendLiveReload.js    reloads the page when a frontend file is saved
    │   └── keepMacAwake.js          caffeinate while the server runs (macOS), so the phone can reach it
    ├── routes/
    │   ├── apiRouter.js             mounts every route file below (order matters for /investments)
    │   ├── accountRoutes.js         /accounts  (+ close, reopen, reconcile)
    │   ├── transactionRoutes.js     /transactions
    │   ├── currencyRoutes.js        /currencies, /exchange-rates/:currency?date= (to prefill the euros)
    │   ├── recurringTransactionRoutes.js /recurring-transactions (rules: add, edit, pause, delete)
    │   ├── categoryRoutes.js        /categories: income and expense ones (rename / merge / move, spending pace, icon + colour)
    │   ├── tagRoutes.js             /tags (add / rename or merge / dates / delete), /tags/report
    │   ├── budgetRoutes.js          PUT /categories/:id/budget, GET /budgets/this-month
    │   ├── forecastRoutes.js        /forecast, and its plan: /forecast/phases, /forecast/events, /forecast/assumptions
    │   ├── investmentTradeRoutes.js /investments/trades
    │   ├── investmentTargetRoutes.js /investments/targets, /investments/allocation?new_money= (before the holdings, like the trades)
    │   ├── investmentHoldingRoutes.js /investments, /investments/history, /investments/:ticker
    │   ├── netWorthRoutes.js        /net-worth, /net-worth/history
    │   ├── statementRoutes.js       /statements?from=&to= (Statements page; a period starts no earlier than the first record)
    │   ├── yearInReviewRoutes.js    /year-in-review?year=
    │   ├── insightRoutes.js         /insights/category-trends, /reconciliation-reminders
    │   ├── settingRoutes.js         /settings (the ones stored with your data)
    │   ├── todoRoutes.js            /todos (Next up page)
    │   ├── backupRoutes.js          /backups, /backups/open, /export, /import
    │   ├── databaseDumpRoutes.js    /database (debug)
    │   └── editionRoutes.js         /edition.js: the tiny script that tells the page full or light
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
    │   ├── tagReport.js             per tag: spent, received, net, count, dates, spending by category, other currencies + exchange cost
    │   ├── foreignCurrencyAmounts.js a foreign-currency transaction as the API shows it: charged rate, exchange cost (pure maths)
    │   ├── exchangeRates.js         market rates (cached, time-limited), and filling in the ones missing (saved offline)
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
    │   ├── forecast.js              the Forecast page's data: start values, history, real averages, band, key numbers, FIRE
    │   ├── fireNumber.js            the maths only: FIRE number, and the month the forecast reaches it
    │   ├── targetAllocation.js      the maths only: drift from the targets, splitting new money without selling (water-filling)
    │   ├── categoryTrends.js        each expense category this month vs its usual average (trips left out), 12-month sparkline
    │   ├── monthWrapUp.js           last month in a few lines for Home, shown from the 1st until closed
    │   ├── savingsGoals.js          goals paid for by cutting back: baseline − spent per month, the queue, the purchase; suggested baselines
    │   ├── reconciliationReminders.js which accounts are due to be counted again
    │   ├── sankeyFlows.js           the Statements' money flows (Sankey): sources and uses that add up to the income statement
    │   ├── yearInReview.js          the Year in review page, built from the statements, tags and targets
    │   ├── appSettings.js           reads and saves the settings of config/appSettings.js
    │   ├── yahooFinanceMarketData.js prices and history from Yahoo, converted to EUR
    │   ├── livePrices.js            today's price of a holding: asked once a minute at most, else the last one kept
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

**Forecast** (migrations 12 and 13): the plan is a list of phases (each only says the month it starts, so they can't
overlap), one-off events and one row of assumptions. An event can sell a personal-use asset, or (migration 13) be
linked to investments: then its money only changes place (− buys investments, + sells them) and net worth doesn't move. `forecastSimulation.js` steps forward month by month (returns,
depreciation, the phase's income − expenses raised with inflation, events, investments sold when cash runs out);
`forecast.js` gives it today's real values and adds the history, the 0%/8% band and the key numbers.

**Foreign currency** (migration 14). Accounts stay in euros and every balance and total uses the euros charged
(`amount`). A transaction can also remember what it cost in another currency: `original_currency` ("JPY") and
`original_amount_minor`, in that currency's own minor units (the yen has no decimals, the Kuwaiti dinar three: see
`config/currencies.js`), plus `original_market_rate`, that day's market rate (units per 1 €). The rate is looked up when
the transaction is saved (`services/exchangeRates.js`); offline, or for transactions added by a recurring rule, it's
left empty and filled in later by `fillMissingMarketRates` (at startup, after recurring transactions are added, after
such a save). `services/foreignCurrencyAmounts.js` turns those columns into what the API shows: `original_amount`,
`charged_rate`, `exchange_cost`. Tag totals (`tagReport.js`) add them up per currency for a trip.

**Target allocation and settings** (migration 15). `investment_targets`: the target share of each ticker, in basis
points (70% = 7000, integers so "adds up to 100%" is exact). `app_settings`: preferences that belong with your data and
travel in the JSON backup (drift threshold, trend thresholds, reconciliation intervals, FIRE rate); which ones exist and
their ranges are in `config/appSettings.js`. `services/targetAllocation.js` is the maths: drift, and the split of new
money that never sells (it fills the fund furthest below its target first).

**Category trends and reconciliation reminders** (no migration). `categoryTrends.js`: per expense category, this month's
projection against the average of the complete months before it, trips (tags with dates) left out of the average by
default. `reconciliationReminders.js`: open accounts whose `last_reconciled` is older than their interval.

**Money flows and FIRE** (no migration). `sankeyFlows.js` builds the Statements' Sankey from the income statement and the
cash side of the trades, so it always adds up to it. `fireNumber.js`: yearly expenses ÷ withdrawal rate, and when the
forecast's cash + investments reach it (the car never counts).

**Goals** (migration 17). Something you'd buy anyway, paid for by spending less. `savings_goals`: name, target, start
date, place in the queue, the purchase once made; `savings_goal_categories`: the categories that pay for it, each with a
baseline (cents a month) fixed when the goal is made. `services/savingsGoals.js`: each month, baseline − spent goes to the
goal (prorated in partial months, negative when over); a category shared by two goals pays the first one in the queue
until it's full, and what a goal collects above its target goes on to the next. A goal's purchase never counts as
spending in any goal's categories. Routes: `savingsGoalRoutes.js`.
An income can be linked to a goal (migration 22, `savings_goal_incomes`; from the goal's card on the Goals page,
`POST /savings-goals/:id/incomes`): its whole amount goes to that goal in its month, on top of the cutting back. Income not linked never
counts toward a goal; a linked one is still ordinary income everywhere else. The pace counts the cutting back only.

**Year in review** (no migration). `yearInReview.js` calls `buildFinancialStatements` for the year (clamped to your
first record exactly like Statements, `findFirstDayOfAnyRecord` in `db/firstRecordedDate.js`), so the two pages always
agree, then adds the year's months, categories vs the same dates of the year before, trips and investments.

The tests live in `tests/` (see **Tests** below).

## Frontend

`frontend/serviceWorker.js` keeps copies of the pages and data so netto opens without the server (network first).

`frontend/HTML/Home.html` is the only page. Each sidebar entry is a `<section data-page="…">` in it.
It loads `JS/themeBeforeFirstPaint.js` (a normal script, so the theme, colour and layout are set before anything is drawn)
and `JS/main.js` as an **ES module**: every other JS file is reached through `import` statements, so
each file says at the top exactly what it uses and where it comes from.

```
frontend/JS/
├── main.js                          connects every feature, then loads the data (start reading here)
├── themeBeforeFirstPaint.js
├── core/                            shared by everything
│   ├── apiClient.js                 callApi(): fetch + error handling
│   ├── phoneFeatures.js             the phone shows the essentials (desktop-only parts stay on the computer)
│   ├── appSettings.js               the settings stored with your data: load, save, bind a number input to one
│   ├── currencies.js                the currency list (from the server) and how foreign amounts are written
│   ├── appState.js                  data shared by several pages (accounts, transactions, …)
│   ├── dataRefresh.js               loadAllData(), runThenReloadAllData() (netto light loads fewer things)
│   ├── edition.js                   isLightEdition: the few places the JS treats netto light differently
│   ├── domHelpers.js                elementById, createElement, fillTableBody, …
│   ├── decimalInputs.js             phones: decimal fields that take "12,50" (the Italian keyboard's comma)
│   ├── pendingChanges.js            edits and deletions kept on this device while the Mac can't be reached (apiClient keeps them)
│   ├── formatting.js                euro / share / date formats, animated amounts
│   ├── accountPickers.js            the account dropdowns
│   ├── accountKinds.js              account kind labels and liquidity classes (same list as backend/config)
│   ├── netWorthGroups.js            Home's 3 groups: liquid (cash + vouchers), investments, immobilized (car); bar widths
│   ├── categoryPickers.js           the category dropdowns (only the kind the transaction type uses)
│   ├── categoryIcons.js             the categories' icon set and colours (white drawing on a colour circle), guesses from a name
│   ├── transactionDisplay.js        the coloured +/− amount cell (with the foreign amount under it), the ↻ for recurring ones,
│   │                                Pocket's round icon of each row and its day ("Yesterday")
│   ├── recurrenceDates.js           next dates and "Every month on the 5th" (same maths as the server)
│   ├── connectionState.js           can the server be reached? (fresh answer vs a copy saved by the service worker)
│   ├── offlineQueue.js              new transactions kept on this device while the server is unreachable, sent later
│   └── errorBanner.js               the red line at the top
├── app/                             the page frame
│   ├── pageNavigation.js            #hash → which section is shown
│   ├── dialogWindows.js             openDialog(), data-open / data-close buttons
│   ├── sheetPosition.js             phones: keeps an open sheet inside what you see while the keyboard is up (visualViewport)
│   ├── keyboardShortcuts.js         N and P
│   ├── serverSession.js             /session connection + live reload
│   ├── offlineStatus.js             the line at the top when the server is unreachable + the transactions waiting
│   ├── phoneMenu.js                 phones: the sliding menu, the top bar with the page name and the eye button
│   └── phoneTables.js               phones: each table in a box that scrolls sideways, so it can fill its card
├── pages/                           one file per sidebar page
│   ├── monthWrapUp.js               Home: the month's wrap-up card and its "Got it"
│   ├── quickAdd.js                  Home: one-tap buttons for your most frequent transactions, Undo / Change
│   ├── homePage.js                  net worth + liquid / investments / immobilized cards and bar, latest transactions
│   ├── reconciliationReminders.js   accounts due to be reconciled: a line on Home, a list on Next up
│   ├── assetsPage.js  + assetsPieChart.js
│   ├── transactionsPage.js          list + filters (+ the day rows and round icons Pocket shows)
│   ├── recurringPage.js             recurring transactions and what they add up to per month
│   ├── categoriesPage.js  + tagManagement.js (the Tags list under the categories; loads the tags for everyone)
│   │                       (expense categories also have their monthly budget field and "every day / one-off" here)
│   ├── investmentsPage.js  + investmentPriceHistoryChart.js + targetAllocation.js (targets, drift, where to put new money)
│   ├── insightsPage.js  + netWorthHistoryChart.js + liquidityInsights.js + monthProjection.js + tagInsights.js
│   │                       + budgetProgress.js (This month > Budgets: a bar per budgeted category)
│   │                       + categoryTrends.js (each category vs its usual, with a sparkline)
│   ├── goalsPage.js                 Goals: a card per goal (bar, categories, pace, link income and the purchase, month by month), the queue
│   ├── forecastPage.js              key numbers, warnings, the real + forecast chart  + forecastPlanEditor.js (phases, events, sliders)
│   │                                + fireNumber.js (the FIRE panel and its line on the chart)
│   ├── statementsPage.js            bridge, investment returns, income statement + estimated taxes, budget vs actual, balance sheet (+ after tax)
│   │                                + moneyFlows.js (the Sankey diagram)
│   ├── yearInReviewPage.js          Year in review: a column of cards for one year
│   └── nextUpPage.js
├── dialogs/                         add / edit windows
│   ├── transactionDialog.js  + transactionTagPicker.js (the Tags field: chips, Enter to add, date suggestions)
│   │                         + foreignCurrencyFields.js ("Paid in JPY": the euros prefilled at the market rate, the exchange cost)
│   ├── quickReconcileDialog.js      reconcile one account, from a reminder
│   ├── accountDialog.js
│   ├── tradeDialog.js
│   ├── recurringTransactionDialog.js
│   ├── goalDialog.js                add / edit a goal: categories with their baselines (suggested from your averages)
│   ├── categoryLookDialog.js        a category's icon and colour picker (Categories page)
│   ├── transactionCategoryChips.js  Pocket: the most used categories as round icons in the transaction window
│   └── reconcileDialog.js
├── charts/                          drawing only, no app data
│   ├── lineChart.js
│   ├── stackedAreaChart.js          (optional: a lighter forecast part after "today", and a band)
│   ├── chartAxis.js             value axis, date labels, tooltip placement (shared)
│   ├── horizontalBarChart.js
│   ├── waterfallChart.js            the Statements page's net worth bridge
│   ├── sankeyChart.js               the Statements page's money flows
│   ├── sparkline.js                 the tiny 12-month lines of the category trends
│   └── svgHelpers.js
└── settings/                        Settings page and the preferences it controls
    ├── themeAndAccentColor.js       Settings > Theme, Color, Layout and On this phone
    ├── privacyMode.js
    ├── autoRefresh.js
    ├── backupSettings.js
    └── reminderSettings.js          Settings > Reminders and highlights (stored with the data, not the browser)
```

`frontend/CSS/` is split the same way into numbered files (`01-theme-colors.css` … `37-ui-pocket.css`; `31-phone.css` holds everything for narrow screens; `22-…` is the
"just for fun" Home background, not loaded).
Home.html loads them in number order; the order matters because a later rule wins over an earlier one
with the same specificity.

## Layouts, and what the phone shows

Settings > Layout picks how the pages are arranged and drawn, per device (localStorage, like the theme). It's only CSS:
`<html data-ui="classic|pocket">`, set by `themeBeforeFirstPaint.js` and changed by `settings/themeAndAccentColor.js`.

| layout | file | on a computer | on a phone |
| --- | --- | --- | --- |
| Classic | (the base files 01–35) | the sidebar on the left, dark green with glows | the sidebar slides in from ☰ |
| Pocket | `37-ui-pocket.css` | a sidebar like a Mac app's: the pages grouped (Every day, Planning, Looking back) with icons, net worth at the bottom | drawn like an iOS app (Apple's guidelines, iOS 26 Liquid Glass): a large title that moves into the top bar on scroll, Settings and the eye as glass buttons, a floating glass tab bar (Transactions, Assets, Home, Insights, Investments), a round + to add, dialogs as sheets with a grabber; the transaction window as an iOS form (segmented type, big amount, grouped rows, ✕ / ✓ in the corners) |

- The sidebar's links stay in Classic's order in Home.html; Pocket reorders them with flex `order`, and shows the
  `.nav-group` names, which are hidden everywhere else.
- Panel, Grid, Grid red and Pocket dashboard were tried in Oct 2026 and removed; a device that had one picked opens in Pocket.

**The phone shows the essentials.** On a screen 800px wide or less, whatever the layout, netto keeps to Home,
Transactions, Insights (this month, budgets, spending by category, tags), Assets, Investments and part of Settings. Everything
else is marked `class="desktop-only"` in Home.html and stays on the computer: the hiding is CSS (`31-phone.css`), and
`core/phoneFeatures.js` stops the left-out pages from opening (they open Home, like netto light's).
Settings > On this phone > Everything turns it off on that phone (`<html data-phone-features="all">`).
- **Adding a page or a part:** it shows on the phone too, unless you mark it `desktop-only`.

## Two editions: netto and netto light

One codebase, two ways to run it. `npm start` / `npm run dev` is the full netto, as always.
`npm run light` (port 3002) is **netto light**, a simpler version for someone who doesn't track every cent:

| netto light keeps | it leaves out |
| --- | --- |
| Home, Assets, Transactions, Recurring, Categories, Investments, Insights, Settings | Goals, Statements, Forecast, Year in review, Next up |
| tags, quick add, foreign currency, hide amounts, backups | budgets, habitual / one-off, month projection, liquidity, category trends |
| Insights > This month: income, spent, saved so far | target allocation, reconciliation reminders, the month wrap-up on Home (it stays in Settings) |

- **Its own data.** NETTO_EDITION=light makes `config/projectPaths.js` default to `backend/db/light.db`,
  `backend/db/light-backups/` and "netto light backups" in iCloud, so it never opens money.db. Same schema and
  migrations, so a light database can be opened by the full app (and a JSON backup moves between them).
- **How the page knows.** Home.html loads `GET /edition.js` in its `<head>`; it sets `<html data-edition="light">`
  before anything is drawn. In Home.html, `class="full-only"` marks what only the full app shows and
  `class="light-only"` what only netto light shows; `35-light-edition.css` does the hiding.
  The JS checks `isLightEdition` (core/edition.js) only where hiding isn't enough: which pages exist
  (app/pageNavigation.js), which data loads (core/dataRefresh.js), the Categories columns, Insights > This month.
- **Adding a feature:** it's in both editions unless you mark it `full-only`.
- **A demo:** `npm run light:demo` fills an empty light.db with a few made-up months (start over: delete light.db).

## The PWA (pwa/)

The same frontend and backend, with no server: `npm run pwa:build` bundles `backend/` into a Web Worker that runs
on SQLite WASM (data in the browser's OPFS), and the page talks to it with messages instead of HTTP
(`frontend/JS/core/localApi.js`, chosen when `<html data-runtime="browser">`). Prices come through a Cloudflare
Worker (`pwa/priceProxy/`). GitHub Pages serves `dist/pwa` (`.github/workflows/deploy-pwa.yml`). See `pwa/README.md`.

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
prices for VWCE.MI and AAPL, a made-up daily price history, and fixed exchange rates (160 JPY, 1,25 USD, 0,8 GBP and
0,3125 KWD per euro; `setFakeExchangeRatesReachable(false)` plays "offline"). Any other ticker or currency behaves like an unknown one.

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
├── categories.test.js                  rename, merge, move to the other kind (and when it's blocked), icon + colour
├── spendingPace.test.js                daily vs occasional categories in the month projections (migration 16)
├── tags.test.js                        migration 10, a transaction's tags, rename / merge / delete, totals, JSON backups
├── budgets.test.js                     migration 11, setting limits (history), partial months, projection, budget vs actual
├── investmentReturns.test.js           XIRR vs Excel, edge cases, TWR vs MWR, returns on the dataset (TWR checked day by day)
├── italianTaxes.test.js                deferred tax (no offsetting), bollo (prorated, 5,000 € threshold), capital gains tax
├── forecast.test.js                    straight line, compound interest, annuity, inflation, phases, events, shortfall, averages, API
├── forecastInvestmentTransfers.test.js events linked to investments: net worth unchanged, growth, selling limit, API, backups, migration 13
├── statements.test.js                  bridge.unexplained = 0 and balance sheet = bridge, on fixed and random periods
├── foreignCurrency.test.js             minor units (JPY 0, EUR 2, KWD 3), rates, exchange cost, offline fill-in, recurring, trip totals, backups, migration 14
├── targetAllocation.test.js            drift, the no-selling split (balanced, far off, too little money, no target), targets API, settings, backups
├── categoryTrends.test.js              fewer than 6 months, trips left out, running hot (share AND amount), recurring still due
├── reconciliationReminders.test.js     the intervals per kind, never the car or closed accounts, 0 = off
├── moneyFlowsAndFire.test.js           the Sankey adds up to the income statement (fixed + random periods, spending more than income), FIRE maths and API
├── yearInReview.test.js                every total equals Statements for the same year, trips, investments, the year before
├── monthWrapUp.test.js                 totals = the month's transactions, shown once until closed, months before any record
├── savingsGoals.test.js                baseline − spent, overspending, the queue and what's passed on, the purchase left out, API, merging
├── goalIncome.test.js                  income linked to a goal: counted on top, passed on above the target, only income, edits, backup
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
were renamed). Since then, migration 7 added recurring transactions, migration 10 tags, migration 11 budgets, migration 12 the forecast plan,
migration 14 foreign-currency amounts and migration 15 investment targets and settings.
