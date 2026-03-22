const express = require("express");
const db = require("../../db/database.js");
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const router = express.Router();

router.get('/investments', function (req, res) {

  const rows = db.prepare(`SELECT * FROM investments`).all();

  res.json(rows);
});

router.post('/investments', function (req, res) {
  try {
    const query = db.prepare(`
      INSERT INTO investments (ticker, amount_invested, average_purchase_price, shares)
      VALUES ($ticker, $amount_invested, $average_purchase_price, $shares)
    `);

    query.run(req.body);

    res.status(200).json({ message: "Investment added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/investments', async function (req, res) {
  try {
    const result = await yahooFinance.quote(req.body.ticker);
    const rate = await yahooFinance.quote('USDEUR=X');
    res.json(result.regularMarketPrice * rate.regularMarketPrice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;