# netto as a PWA

The plan is the doc "netto come PWA — mappa del deploy". In short: the phone holds the app **and** the data, a
Cloudflare Worker fetches the prices, and GitHub Pages only serves the files.

```
phone (pages + backend in a Web Worker + SQLite WASM in OPFS)  →  Cloudflare Worker (prices only)  →  Yahoo Finance
```

## How it works

The backend is **not rewritten**: `backend/` itself is bundled into a Web Worker (`browserBackend/apiWorker.js`),
with stand-ins for what only exists in Node:

| In Node                    | In the PWA                                                        |
| -------------------------- | ----------------------------------------------------------------- |
| `better-sqlite3`           | `browserBackend/betterSqlite3OverWasm.js` (SQLite WASM, file in OPFS) |
| `express` + HTTP           | `browserBackend/expressRouterInTheBrowser.js` (messages, no port) |
| `yahoo-finance2`           | `browserBackend/yahooFinanceThroughPriceProxy.js` → `priceProxy/` |
| `fs`, `path`, `os`, `chalk`, `config/projectPaths.js` | `browserBackend/standIns/`             |

The page knows it's the PWA from `<html data-runtime="browser">` (set by the built `edition.js`); `callApi`
then posts to the worker (`frontend/JS/core/localApi.js`) instead of `fetch()`.

## Commands

```bash
npm run pwa:build          # -> dist/pwa (NETTO_PRICE_PROXY_URL=... for prices)
npm run pwa:preview        # build + serve on http://localhost:4173/HTML/Home.html
npm run pwa:proxy:deploy   # publish priceProxy/ on Cloudflare (asks to log in the first time)
```

Publishing: `.github/workflows/deploy-pwa.yml` builds and deploys to GitHub Pages on every push to `main`.

## Status (deploy map steps)

- [x] 1–2 routes and SQLite in the browser (same code, bundled)
- [x] 3 price proxy (Cloudflare Worker) — not deployed yet
- [x] 4 service worker for offline (precache) — basic
- [~] 5 export works; import, the 7-day reminder and the Settings backup panel still assume the Mac server
- [x] 6 GitHub Pages workflow — needs Pages turned on (see below)
- [ ] 7 phone layout
- [ ] 8 sync via Drive / Dropbox

Known gaps: Settings > backups (folder, daily copies, iCloud) answers errors in the PWA; a future migration on a
browser database with data would fail on its "copy before migrating" step (it writes a file); the offline banner
and pending-changes queue are server-only and simply stay idle.
