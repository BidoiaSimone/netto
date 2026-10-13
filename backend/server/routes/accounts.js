const express = require("express");
const db = require("../../db/database.js");
const { toCents, toEuros } = require("../money.js");

const router = express.Router();
const today = () => new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD (toISOString would be UTC)
const KINDS = ["cash", "bank", "savings", "asset"];

// DB row (cents) -> API (euros). `balance` is stored in the accounts table and kept up to date
// by triggers in the database (schema.js, migration 3) every time a transaction is added.
const toApi = (a) => ({ ...a, opening_balance: toEuros(a.opening_balance), balance: toEuros(a.balance) });

router.get("/accounts", function (req, res) {
  res.json(db.prepare(`SELECT * FROM accounts ORDER BY id`).all().map(toApi));
});

// opening_balance: what the account holds today, before any transaction is recorded on it
router.post("/accounts", function (req, res) {
  const name = String(req.body?.name ?? "").trim();
  const opening = toCents(req.body?.opening_balance);
  const kind = req.body?.kind ?? "cash";

  if (!name || !Number.isFinite(opening)) return res.status(400).json({ error: "name and a numeric opening_balance are required" });
  if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of: ${KINDS.join(", ")}` });

  try {
    // the starting balance is typed in by hand, so it counts as verified today.
    // No transactions yet, so the balance is the opening balance.
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO accounts (name, kind, opening_balance, balance, open_date, last_reconciled) VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, kind, opening, opening, today(), today());
    res.status(201).json({ message: "Account added successfully", id: lastInsertRowid });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: `${name} already exists` });
    res.status(500).json({ error: err.message });
  }
});

// Recount: you tell it what is really in the account. The difference from the recorded balance
// is saved as an 'adjustment' transaction; the insert trigger then moves the balance to the
// counted amount, so the history still adds up.
router.post("/accounts/:id/reconcile", function (req, res) {
  const id = Number(req.params.id);
  const counted = toCents(req.body?.counted);
  if (!Number.isFinite(counted)) return res.status(400).json({ error: "counted must be a number" });

  try {
    const result = db.transaction(() => {
      const acc = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(id);
      if (!acc) return null;

      const difference = counted - acc.balance; // integers: exact, no rounding needed
      if (difference !== 0) {
        db.prepare(`
          INSERT INTO transactions (from_account_id, to_account_id, type, amount, description, date)
          VALUES (?, ?, 'adjustment', ?, 'Recount', ?)
        `).run(difference < 0 ? id : null, difference > 0 ? id : null, Math.abs(difference), today());
      }
      db.prepare(`UPDATE accounts SET last_reconciled = ? WHERE id = ?`).run(today(), id);
      return { difference: toEuros(difference) };
    })();

    if (!result) return res.status(404).json({ error: "Account not found" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
