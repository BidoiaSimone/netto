/* MIGRATION 15. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 15: target allocation of the investments, and a place for settings ----
//
// investment_targets: the share of the portfolio you want in each ticker ("SWDA.MI 70%, EIMI.MI 15%, VWCE.MI 15%").
//   Stored in BASIS POINTS, hundredths of a percent, as an integer: 70% = 7000, 12.5% = 1250. Integers add up
//   exactly, so "do the targets make 100%?" is a plain `= 10000`, never 99.99999999. The API replaces the whole list
//   at once and refuses one that doesn't add up to 100% (routes/investmentTargetRoutes.js); a ticker without a row
//   counts as a 0% target. Tickers are text like in investment_trades, not a reference to `investments`: you can set
//   a target for a fund you haven't bought yet, and `investments` rows are rebuilt from the trades anyway.
//
// app_settings: small preferences that belong with your data (and so travel in the JSON backup), rather than in one
//   browser: e.g. how big a drift is highlighted. One row per setting; the value is JSON text. Which keys exist,
//   their defaults and their allowed range are in config/appSettings.js: a key with no row has its default.
function createInvestmentTargetsAndSettings(db) {
  db.exec(`
    CREATE TABLE investment_targets (
      ticker TEXT PRIMARY KEY CHECK (ticker = upper(trim(ticker)) AND length(ticker) > 0),
      target_basis_points INTEGER NOT NULL CHECK (target_basis_points BETWEEN 1 AND 10000)  -- 7000 = 70.00%
    ) WITHOUT ROWID;

    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL   -- JSON: 5, "monthly", true...
    ) WITHOUT ROWID;
  `);
}

module.exports = createInvestmentTargetsAndSettings;
