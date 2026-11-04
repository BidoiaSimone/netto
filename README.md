# netto

A personal money tracker: accounts, transactions, investments and net worth, with budgets, goals, forecasts and
year-in-review on top. Your data stays yours — a SQLite database on your Mac, or in your own browser with the PWA.
No accounts, no cloud service holding your numbers.

## What it does

- **Home** — net worth at a glance, split into liquid, invested and immobilized, plus the latest transactions
- **Transactions & Recurring** — income, expenses and transfers, with tags, categories, foreign currencies and
  rules that post themselves when due
- **Assets** — every account and its balance, with reconciliation reminders
- **Investments** — trades, holdings, live prices (Yahoo Finance) in euros, returns, target allocation
- **Insights** — this month, budgets, spending by category, trends, money flows, FIRE number
- **Goals, Statements, Forecast, Year in review** — planning and looking back (Statements includes Italian tax estimates)
- **Backups** — automatic daily copies, an optional iCloud Drive copy, and a full JSON export / restore

Money is stored as integer cents, so totals never drift. netto speaks English and Italian: it follows the device's language,
and Settings > Language changes it on each device.

## Use it on your phone

netto is published on GitHub Pages: **<https://bidoiasimone.github.io/netto/>**

Nothing to install from a store and no account to make: the whole app, data included, runs inside your phone's browser.

1. **Open the link** on the phone: Safari on an iPhone, Chrome on Android.
2. **Add it to the Home Screen**, so it opens like an app, full screen and offline:
   - iPhone: the Share button → **Add to Home Screen** → Add
   - Android: the ⋮ menu → **Add to Home screen** (or **Install app**)
3. **Open netto from its icon** from then on. On an iPhone the icon and Safari keep separate data, so using both
   would give you two separate nettos.
4. **Start:** Assets → **+ Add account or asset** (cash, a current account… with what each holds today), then the
   round **+** adds income and expenses.

Good to know:

- **Your data stays on the phone.** No server and no cloud: nobody else can see it, and nothing moves it to another
  device. That also means **back it up now and then**: Settings → **Save backup…** → on an iPhone, *Save to Files →
  iCloud Drive*. netto reminds you when it's been a while. **Restore backup (JSON)…** brings a backup back (also one
  made on the Mac).
- **Don't use a private tab**, and on an iPhone keep *Block All Cookies* off (Settings → Apps → Safari): otherwise the
  browser doesn't let netto keep anything, and it says so at the top of the page.
- **Language:** netto opens in Italian on a phone set to Italian, in English otherwise. Settings → Language changes it.
- **The phone shows the essentials** (Home, Transactions, Recurring, Insights, Categories, Assets, Investments,
  Settings). Settings → On this phone → **Everything** shows every page, as on the Mac.
- **Updates come by themselves:** every change to `main` is published, and the app switches to the new version the
  next time it's opened.
- **Investment prices** come from Yahoo Finance through a small price proxy; without a connection the app still works,
  and shows the last prices it had.

## Ways to run it

| | Where the app runs | Where the data lives |
| --- | --- | --- |
| **On a Mac** (`npm start`) | Express on `localhost:3000` | `backend/db/money.db` |
| **netto light** (`npm run light`) | Express on `localhost:3002`, fewer pages | `backend/db/light.db` |
| **PWA** ([on GitHub Pages](https://bidoiasimone.github.io/netto/), or `npm run pwa:build`) | entirely in the browser, installable on a phone | the browser's private storage (OPFS) |

### On a Mac

Requires Node.js (developed on 24, which the PWA workflow also uses).

```bash
npm install
npm start
```

Then open <http://localhost:3000>. `npm run dev` restarts the server when backend code changes.

To keep it running in the background (starts at login, restarts if it crashes):

```bash
bash scripts/service.sh install
```

`scripts/service.sh` also takes `status`, `log`, `restart`, `stop`, `start` and `uninstall`.
`scripts/autosync.sh install` keeps the checkout in sync with GitHub and reloads open pages.

### As a PWA

Published at <https://bidoiasimone.github.io/netto/> by `.github/workflows/deploy-pwa.yml` on every push to `main`
(see [Use it on your phone](#use-it-on-your-phone)). The same frontend and backend code, with no server: the backend is bundled into a Web Worker running SQLite
compiled to WebAssembly, and investment prices come through a small Cloudflare Worker.

```bash
npm run pwa:preview        # build and serve on http://localhost:4173/HTML/Home.html
```

How it's built, published and how the price proxy is deployed: [pwa/README.md](pwa/README.md).

## Project layout

```
backend/
  config/       settings, account kinds, currencies, tax rates, paths
  db/           connection, numbered migrations, maintenance tools
  server/       Express app: routes → validation → services
frontend/
  HTML/Home.html  the single page
  CSS/            one file per topic, in load order
  JS/             core helpers, pages, dialogs, charts, settings
pwa/            browser build, browser stand-ins for Node modules, price proxy
scripts/        launchd service, autosync, launcher
tests/          node --test suites
```

[CODE_MAP.md](CODE_MAP.md) explains where everything lives and why, file by file.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | start the server |
| `npm run dev` | start it with auto-reload (nodemon) |
| `npm test` | run every test in `tests/` |
| `npm run light` | start netto light |
| `npm run light:demo` | fill an empty `light.db` with made-up months |
| `npm run db:print` | print the database tables |
| `npm run db:clear -- --yes` | delete **all** data |
| `npm run pwa:build` | build the PWA into `dist/pwa` |
| `npm run pwa:preview` | build and serve the PWA locally |
| `npm run pwa:proxy:deploy` | deploy the price proxy to Cloudflare |

## Your data

- `money.db`, its backups and downloaded JSON backups are git-ignored — never commit them.
- Every schema change is a new migration; a copy of the database is saved before one runs.
- The server only answers requests from its own host, and doesn't write amounts or descriptions to its log.

## License

ISC
