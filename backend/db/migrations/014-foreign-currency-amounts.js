/* MIGRATION 14. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 14: what a transaction cost in a foreign currency ----
// On a trip you pay ¥1.200 for a ramen and your card charges 7,45 €. The account only ever sees the euros, and
// they stay the transaction's real amount: balances, statements and budgets keep using `amount` (euro cents)
// exactly as before. These columns only remember the other side of it:
//
//   original_currency       the ISO 4217 code, e.g. 'JPY' (NULL = paid in euros, as every transaction so far)
//   original_amount_minor   the foreign amount, in that currency's own minor units (config/currencies.js):
//                           ¥1.200 -> 1200 (the yen has no decimals), 12,50 $ -> 1250, 1,250 KWD -> 1250
//   original_market_rate    the market exchange rate on the transaction's date, as units of the currency per
//                           1 € (EURJPY = 161.2). Not money, so a REAL is fine. Comparing it with the rate the
//                           card actually used (original amount / euro amount) gives the exchange cost.
//                           NULL = not known (yet): the server fills it in when Yahoo can be reached.
//
// The currency and the amount are always set together, or both left empty: an amount without its currency
// can't be read (1200 could be ¥1.200 or 12,00 $). Recurring rules get the first two (a subscription billed in
// dollars); each transaction they add copies them, and gets its own day's market rate.
function addForeignCurrencyAmounts(db) {
  const addColumns = (tableName, withMarketRate) => db.exec(`
    ALTER TABLE ${tableName} ADD COLUMN original_currency TEXT
      CHECK (original_currency IS NULL OR (length(original_currency) = 3 AND original_currency = upper(original_currency) AND original_currency <> 'EUR'));
    ALTER TABLE ${tableName} ADD COLUMN original_amount_minor INTEGER
      CHECK ((original_amount_minor IS NULL) = (original_currency IS NULL) AND (original_amount_minor IS NULL OR original_amount_minor > 0));
    ${withMarketRate ? `ALTER TABLE ${tableName} ADD COLUMN original_market_rate REAL
      CHECK (original_market_rate IS NULL OR (original_currency IS NOT NULL AND original_market_rate > 0));` : ""}
  `);
  addColumns("transactions", true);
  addColumns("recurring_transactions", false);
}

module.exports = addForeignCurrencyAmounts;
