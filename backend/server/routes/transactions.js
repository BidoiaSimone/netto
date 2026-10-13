const express = require("express");
const db = require("../../db/database.js");
const { toCents, toEuros } = require("../money.js");

const router = express.Router();
const today = () => new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD

// No date given -> today. Returns null for an invalid date.
function parseDate(d) {
  if (d === undefined || d === null || d === "") return today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const parsed = new Date(d + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d) ? d : null; // rejects 2026-02-30
}

// "" / null / undefined -> null, anything else -> a number (NaN if it isn't one)
const optionalId = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

// [needs a source account, needs a destination account]
const NEEDS = { income: [false, true], expense: [true, false], movement: [true, true] };

// Account and category names are joined in so the frontend can show them;
// the *_id fields are what it should use to filter or send back.
router.get("/transactions", function (req, res) {
  const rows = db.prepare(`
    SELECT t.*, fa.name AS from_account, ta.name AS to_account, c.name AS category
    FROM transactions t
    LEFT JOIN accounts fa ON fa.id = t.from_account_id
    LEFT JOIN accounts ta ON ta.id = t.to_account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ORDER BY t.date DESC, t.id DESC
  `).all();
  res.json(rows.map((t) => ({ ...t, amount: toEuros(t.amount) })));
});

router.post("/transactions", function (req, res) {
  const b = req.body ?? {};
  const needs = NEEDS[b.type];
  const amount = toCents(b.amount);

  if (!needs) return res.status(400).json({ error: "type must be income, expense or movement" });
  if (!(amount > 0)) return res.status(400).json({ error: "amount must be at least 0.01" });

  const from = needs[0] ? optionalId(b.from_account_id) : null;
  const to = needs[1] ? optionalId(b.to_account_id) : null;
  if ((needs[0] && from === null) || (needs[1] && to === null)) {
    return res.status(400).json({ error: `${b.type} needs ${needs[0] ? "a source" : ""}${needs[0] && needs[1] ? " and " : ""}${needs[1] ? "a destination" : ""} account` });
  }
  if (from !== null && from === to) return res.status(400).json({ error: "source and destination must be different accounts" });

  const date = parseDate(b.date);
  if (!date) return res.status(400).json({ error: "date must be a valid YYYY-MM-DD date" });
  if (date > today()) return res.status(400).json({ error: "date can't be in the future" });

  const accountExists = db.prepare(`SELECT 1 FROM accounts WHERE id = ?`);
  for (const id of [from, to]) {
    if (id !== null && !accountExists.get(id)) return res.status(400).json({ error: `Unknown account id: ${id}` });
  }

  // Only categories from the list are accepted; empty = uncategorized
  const categoryId = optionalId(b.category_id);
  if (categoryId !== null && !db.prepare(`SELECT 1 FROM categories WHERE id = ?`).get(categoryId)) {
    return res.status(400).json({ error: "Unknown category: pick one from the list or add it on the Categories page" });
  }

  try {
    // The trigger transactions_after_insert (schema.js) updates both account balances
    // in the same step, so there is nothing else to do here
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO transactions (from_account_id, to_account_id, type, amount, category_id, description, date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(from, to, b.type, amount, categoryId, b.description?.trim() || null, date);
    res.status(201).json({ message: "Transaction added successfully", id: lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
