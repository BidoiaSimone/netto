/* CURRENCIES AND EXCHANGE RATES, for transactions paid in another currency (migration 14).
 *   GET /currencies                          the currencies a transaction can be paid in, with their decimals
 *   GET /exchange-rates/:currency?date=      the market rate that day, so the dialog can prefill the euros
 */

const express = require("express");
const { listForeignCurrencies, isForeignCurrency } = require("../../config/currencies.js");
const { getMarketExchangeRate } = require("../services/exchangeRates.js");
const { parseDateOrDefaultToToday, getTodayAsLocalDate } = require("../utils/localDates.js");

const router = express.Router();

// [{ code: "JPY", name: "Japanese yen", decimals: 0 }, ...]: the frontend's only copy of the list
router.get("/currencies", function listCurrencies(request, response) {
  response.json(listForeignCurrencies());
});

// { currency, date, units_per_euro, euros_per_unit, rate_date }. rate_date can be earlier than date: markets
// don't trade at weekends, so a Sunday gets Friday's rate. 503 when Yahoo can't be reached: the dialog then
// simply asks for the euros (the euros charged are what counts anyway).
router.get("/exchange-rates/:currency", async function getExchangeRate(request, response) {
  const currency = String(request.params.currency).toUpperCase();
  if (!isForeignCurrency(currency)) return response.status(400).json({ error: `Unknown currency: ${currency}` });
  const date = parseDateOrDefaultToToday(request.query.date);
  if (!date) return response.status(400).json({ error: "date must be a valid YYYY-MM-DD date" });
  const dateToLookUp = date > getTodayAsLocalDate() ? getTodayAsLocalDate() : date;
  try {
    const { unitsPerEuro, rateDate } = await getMarketExchangeRate(currency, dateToLookUp);
    response.json({ currency, date: dateToLookUp, units_per_euro: unitsPerEuro, euros_per_unit: 1 / unitsPerEuro, rate_date: rateDate });
  } catch (error) {
    response.status(503).json({ error: `No exchange rate for ${currency} right now (${error.message}): type the euros charged` });
  }
});

module.exports = router;
