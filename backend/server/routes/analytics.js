const express = require("express");
const db = require("../../db/database.js");
const { getPriceInEur } = require("../services/market.js");
const { toEuros } = require("../money.js");

const router = express.Router();

router.get("/net-worth", async function (req, res) {
  try {
    const accountsValue = toEuros(db.prepare(`SELECT COALESCE(SUM(balance), 0) AS total FROM accounts`).get().total);
    const holdings = db.prepare(`SELECT ticker, shares FROM investments`).all();

    // One failing ticker must not hide the whole net worth, so it is reported instead
    const rates = new Map();
    const prices = await Promise.allSettled(holdings.map((h) => getPriceInEur(h.ticker, rates)));

    let investmentsValue = 0;
    const failedTickers = [];
    prices.forEach((p, i) => {
      if (p.status === "fulfilled") investmentsValue += holdings[i].shares * p.value;
      else failedTickers.push(holdings[i].ticker);
    });

    res.json({
      net_worth: accountsValue + investmentsValue,
      accounts_value: accountsValue,
      investments_value: investmentsValue,
      failed_tickers: failedTickers, // not included in the totals above
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
