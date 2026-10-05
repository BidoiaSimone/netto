const express = require("express");
const db = require("../../db/database.js");
const { getPriceInEur } = require("../services/market.js");

const router = express.Router();

// ---------- helpers ----------

// Attach live market data to a DB row. All money values are in EUR.
async function enrich(inv, rates) {
  const currentPrice = await getPriceInEur(inv.ticker, rates);
  const currentValue = currentPrice * inv.shares;
  const gain = currentValue - inv.amount_invested;

  return {
    ...inv,
    current_price: currentPrice,
    current_value: currentValue,
    gain,
    gain_pct: inv.amount_invested > 0 ? (gain / inv.amount_invested) * 100 : null,
  };
}

const normTicker = (t) => (typeof t === "string" ? t.trim().toUpperCase() : "");

// Validate a request body. amount_invested defaults to shares * average price.
function parseInvestment(body = {}) {
  const shares = Number(body.shares);
  const average_purchase_price = Number(body.average_purchase_price);
  const amount_invested =
    body.amount_invested === undefined || body.amount_invested === "" || body.amount_invested === null
      ? shares * average_purchase_price
      : Number(body.amount_invested);

  const numbers = { shares, average_purchase_price, amount_invested };
  for (const [name, n] of Object.entries(numbers)) {
    if (!Number.isFinite(n) || n <= 0) return { error: `${name} must be a number greater than 0` };
  }
  return { value: numbers };
}

const selectOne = db.prepare(`SELECT * FROM investments WHERE ticker = ?`);

// ---------- routes ----------

// List all investments, enriched with live prices.
// allSettled so one bad ticker doesn't break the whole list.
router.get("/investments", async function (req, res) {
  try {
    const rows = db.prepare(`SELECT * FROM investments`).all();
    const rates = new Map();
    const results = await Promise.allSettled(rows.map((r) => enrich(r, rates)));

    res.json(
      results.map((r, i) =>
        r.status === "fulfilled" ? r.value : { ...rows[i], price_error: r.reason.message }
      )
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single investment, enriched.
router.get("/investments/:ticker", async function (req, res) {
  try {
    const row = selectOne.get(normTicker(req.params.ticker));
    if (!row) return res.status(404).json({ error: "Investment not found" });

    try {
      res.json(await enrich(row, new Map()));
    } catch (priceErr) {
      res.json({ ...row, price_error: priceErr.message }); // DB data is fine, only the live price failed
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create
router.post("/investments", function (req, res) {
  const ticker = normTicker(req.body?.ticker);
  if (!ticker) return res.status(400).json({ error: "ticker is required" });

  const { value, error } = parseInvestment(req.body);
  if (error) return res.status(400).json({ error });

  try {
    db.prepare(`
      INSERT INTO investments (ticker, amount_invested, average_purchase_price, shares)
      VALUES ($ticker, $amount_invested, $average_purchase_price, $shares)
    `).run({ ticker, ...value });

    res.status(201).json({ message: "Investment added successfully", ticker });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return res.status(409).json({ error: `${ticker} already exists, edit it instead` });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update (the ticker is the key, so it can't change: delete and re-add instead)
router.put("/investments/:ticker", function (req, res) {
  const ticker = normTicker(req.params.ticker);
  const { value, error } = parseInvestment(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const info = db.prepare(`
      UPDATE investments
      SET amount_invested = $amount_invested,
          average_purchase_price = $average_purchase_price,
          shares = $shares
      WHERE ticker = $ticker
    `).run({ ticker, ...value });

    if (info.changes === 0) return res.status(404).json({ error: "Investment not found" });
    res.json({ message: "Investment updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete
router.delete("/investments/:ticker", function (req, res) {
  try {
    const info = db.prepare(`DELETE FROM investments WHERE ticker = ?`).run(normTicker(req.params.ticker));

    if (info.changes === 0) return res.status(404).json({ error: "Investment not found" });
    res.json({ message: "Investment deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
