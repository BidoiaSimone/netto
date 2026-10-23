/* WHICH NETTO THIS SERVER IS: the full app, netto light, or netto expenses
 * Same code, same database schema, different ways of showing it. NETTO_EDITION=light (npm run light) gives:
 *   - the light pages only: Home, Assets, Transactions, Recurring, Categories, Investments, Insights, Settings.
 *     No Goals, Statements, Forecast, Year in review, Next up; no budgets, projections, trends, target allocation,
 *     reconciliation reminders or month wrap-up on Home (the wrap-ups stay in Settings).
 *   - its own data: light.db, light-backups/ and "netto light backups" in iCloud (config/projectPaths.js),
 *     so it never reads or writes money.db.
 * NETTO_EDITION=expenses (npm run expenses) is the smallest one, for someone who only writes down what they spend:
 *   - "/" opens HTML/Expenses.html: an amount, a category, Save. Nothing else (no accounts, no net worth).
 *   - HTML/ExpensesReport.html: the months by category, for whoever reads the data (not linked from Expenses.html).
 *   - Home.html still works, drawn like netto light, to correct or delete an entry.
 *   - its own data: expenses.db, expenses-backups/ and "netto expenses backups" in iCloud, with one cash account
 *     and a few expense categories made at startup (services/expensesEditionSetup.js).
 * Anything else (or nothing) is the full app, as always.
 *
 * The page learns which one it is from GET /edition.js (server/app.js), a tiny script Home.html loads
 * before anything is drawn; the hiding itself is CSS (35-light-edition.css) plus a few checks in the JS
 * (frontend/JS/core/edition.js).
 */

const EDITIONS = { FULL: "full", LIGHT: "light", EXPENSES: "expenses" };

const NETTO_EDITION = Object.values(EDITIONS).includes(process.env.NETTO_EDITION) ? process.env.NETTO_EDITION : EDITIONS.FULL;
const IS_LIGHT_EDITION = NETTO_EDITION === EDITIONS.LIGHT;
const IS_EXPENSES_EDITION = NETTO_EDITION === EDITIONS.EXPENSES;

// The name the server, the window and the backups go by
const EDITION_NAMES = { full: "netto", light: "netto light", expenses: "netto expenses" };

// What GET /edition.js answers: marks <html data-edition="..."> before the stylesheets apply
// (and names the window "netto light" / "netto expenses", so they are easy to tell apart in the Dock and the tabs)
const createEditionScript = (edition) => `document.documentElement.dataset.edition = ${JSON.stringify(edition)};\n`
  + (edition !== EDITIONS.FULL ? `document.title = ${JSON.stringify(EDITION_NAMES[edition])};\n` : "");

module.exports = { EDITIONS, EDITION_NAMES, NETTO_EDITION, IS_LIGHT_EDITION, IS_EXPENSES_EDITION, createEditionScript };
