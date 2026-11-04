# netto

A personal money tracker: your accounts, what comes in and goes out, investments and net worth, with budgets, goals
and a look back at each month and year. Your data stays yours: it lives on your phone (or your Mac), with no account
to make and no cloud service holding your numbers.

**Open it: <https://bidoiasimone.github.io/netto/>**

## What it does

- **Home**: your net worth at a glance (what you can spend, what's invested, what's tied up in things like a car),
  today's spending, one-tap buttons for what you add most often, and a short wrap-up at the start of each month
- **Transactions**: income, expenses and money moved between your own accounts, with categories, tags (a trip, a
  project) and amounts paid in other currencies
- **Recurring**: rent, salary, subscriptions… added by themselves when they're due
- **Assets**: every account with what it holds; count what's really there now and then and netto fixes the difference
- **Insights**: this month so far and where it's heading, budgets, spending by category, what each tag cost
- **Categories**: your own, each with an icon and colour, and a monthly budget if you want one
- **Investments**: your funds and shares at today's prices, what you gained, and where to put new money
- **Goals, Statements, Forecast, Year in review** (on a computer): saving up for something by spending less,
  full statements with Italian tax estimates, where your money is heading, and your year in a few cards

netto speaks **English and Italian**: it follows your device's language, and Settings → Language changes it.

## On your phone

1. **Open <https://bidoiasimone.github.io/netto/>** on the phone: Safari on an iPhone, Chrome on Android.
2. **Add it to the Home Screen**, so it opens like an app, full screen, even offline:
   - iPhone: the Share button → **Add to Home Screen** → Add
   - Android: the ⋮ menu → **Add to Home screen** (or **Install app**)
3. **Always open netto from its icon.** On an iPhone the icon and Safari keep separate data, so using both would give
   you two separate nettos.
4. **Start:** Assets → **+ Add account or asset** (your cash, your current account… with what each holds today). Then
   the round **+** adds income and expenses.

Nothing to install from a store, and nothing to sign up for.

- **The phone shows the essentials**: Home, Transactions, Recurring, Insights, Categories, Assets, Investments and
  Settings. Settings → On this phone → **Everything** shows every page.
- **Hide amounts**: the eye button at the top hides every amount, for when someone's looking over your shoulder.
  netto opens with them hidden; Settings → Hide again after… decides when they hide again by themselves.
- **New versions come by themselves**: the app switches to the latest one when you open it.
- **Investment prices** come from Yahoo Finance; without a connection netto still works and shows the last prices it
  had.

## Your data and backups

**Everything stays on your device.** Nothing is sent anywhere: nobody else can see your numbers, and nothing copies
them to your other devices either. So:

- **Save a backup now and then**: Settings → **Save backup…** → on an iPhone, *Save to Files → iCloud Drive*. netto
  reminds you when it's been a while.
- **Restore backup (JSON)…** in Settings brings a backup back, on the same phone or a new one (a backup made with netto
  on a Mac works too). It replaces everything that's there.
- **Don't use a private tab**, and on an iPhone keep *Block All Cookies* off (Settings → Apps → Safari). Otherwise the
  browser won't let netto keep anything, and netto says so at the top of the page.
- Deleting netto from the Home Screen, or clearing Safari's website data, deletes its data too: keep a recent backup.

## On a Mac

netto can also run on a Mac, with its data in a file there, automatic daily backups (and a copy in iCloud Drive), and
every page.

It needs [Node.js](https://nodejs.org). In a Terminal, in netto's folder:

```bash
npm install
```

```bash
npm start
```

then open <http://localhost:3000>. To keep it running in the background, starting by itself at login:

```bash
bash scripts/service.sh install
```

(`bash scripts/service.sh status` says whether it's running; `stop`, `start` and `uninstall` do what they say.)

Settings → **Download backup (JSON)** makes a backup you can open in netto on the phone too.

## Making changes to netto

How it's built, the commands, the tests and where everything lives: [DEVELOPMENT.md](DEVELOPMENT.md).

## License

ISC
