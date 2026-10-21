/* WHICH NETTO THIS SERVER IS: the full app, or netto light
 * Same code, same database schema, two ways of showing it. NETTO_EDITION=light (npm run light) gives:
 *   - the light pages only: Home, Assets, Transactions, Recurring, Categories, Investments, Insights, Settings.
 *     No Goals, Statements, Forecast, Year in review, Next up; no budgets, projections, trends, target allocation,
 *     reconciliation reminders or month wrap-up on Home (the wrap-ups stay in Settings).
 *   - its own data: light.db, light-backups/ and "netto light backups" in iCloud (config/projectPaths.js),
 *     so it never reads or writes money.db.
 * Anything else (or nothing) is the full app, as always.
 *
 * The page learns which one it is from GET /edition.js (server/app.js), a tiny script Home.html loads
 * before anything is drawn; the hiding itself is CSS (35-light-edition.css) plus a few checks in the JS
 * (frontend/JS/core/edition.js).
 */

const EDITIONS = { FULL: "full", LIGHT: "light" };

const NETTO_EDITION = process.env.NETTO_EDITION === EDITIONS.LIGHT ? EDITIONS.LIGHT : EDITIONS.FULL;
const IS_LIGHT_EDITION = NETTO_EDITION === EDITIONS.LIGHT;

// What GET /edition.js answers: marks <html data-edition="..."> before the stylesheets apply
// (and names the window "netto light", so the two are easy to tell apart in the Dock and the tabs)
const createEditionScript = (edition) => `document.documentElement.dataset.edition = ${JSON.stringify(edition)};\n`
  + (edition === EDITIONS.LIGHT ? `document.title = "netto light";\n` : "");

module.exports = { EDITIONS, NETTO_EDITION, IS_LIGHT_EDITION, createEditionScript };
