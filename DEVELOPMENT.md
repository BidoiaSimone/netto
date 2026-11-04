# Working on netto

For using netto, see the [README](README.md). This page is for changing it.

## Ways to run it

| | Where the app runs | Where the data lives |
| --- | --- | --- |
| **On a Mac** (`npm start`) | Express on `localhost:3000` | `backend/db/money.db` |
| **netto light** (`npm run light`) | Express on `localhost:3002`, fewer pages | `backend/db/light.db` |
| **PWA** ([on GitHub Pages](https://bidoiasimone.github.io/netto/), or `npm run pwa:build`) | entirely in the browser, installable on a phone | the browser's private storage (OPFS) |

Money is stored as integer cents, so totals never drift.

### On a Mac

Requires Node.js (developed on 24, which the PWA workflow also uses). `npm install`, then `npm start` and open
<http://localhost:3000>. `npm run dev` restarts the server when backend code changes.

`bash scripts/service.sh install` keeps it running in the background (starts at login, restarts if it crashes); it also
takes `status`, `log`, `restart`, `stop`, `start` and `uninstall`. `scripts/autosync.sh install` keeps the checkout in
sync with GitHub and reloads open pages.

### As a PWA

Published at <https://bidoiasimone.github.io/netto/> by `.github/workflows/deploy-pwa.yml` on every push to `main`.
The same frontend and backend code, with no server: the backend is bundled into a Web Worker running SQLite compiled
to WebAssembly, and investment prices come through a small Cloudflare Worker.

```bash
npm run pwa:preview        # build and serve on http://localhost:4173/HTML/Home.html
```

How it's built, published and how the price proxy is deployed: [pwa/README.md](pwa/README.md).

## Languages

Everything is written in English; `frontend/JS/core/italian.js` has the Italian of every text. Add a new text's
Italian there: `npm test` fails and names any that's missing. See "Languages" in [CODE_MAP.md](CODE_MAP.md).

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

## Real data never goes in the repository

- `money.db`, `light.db`, their backup folders and downloaded JSON backups (`netto-YYYY-MM-DD.json`) are git-ignored
  (`.gitignore`: `*.db`, `backend/db/backups/`, `backend/db/light-backups/`, `netto-*.json`). Never commit them.
- Every schema change is a new migration; a copy of the database is saved before one runs.
- The server only answers requests from its own host, and doesn't write amounts or descriptions to its log.
