const express = require("express");
const db = require("../../db/database.js");

const router = express.Router();

router.get('/transactions', function (req, res) {

  const rows = db.prepare(`SELECT * FROM transactions`).all();

  res.json(rows);
});

router.post('/transactions', function (req, res) {
  try {
    const doTransaction = db.transaction(() => {

      const data = { ...req.body };

      data.to_account = req.body.to_account || null;
      data.from_account = req.body.from_account || null;
      data.date = new Date().toISOString().split('T')[0];

      db.prepare(`
        INSERT INTO transactions (from_account, to_account, type, amount, description, date)
        VALUES ($from_account, $to_account, $type, $amount, $description, $date);
      `).run(data);

      if (data.from_account != null) {
        db.prepare(`
          UPDATE accounts
          SET amount = (amount - $amount)
          WHERE name = $from_account;
        `).run(data);
      }

      if (data.to_account != null) {
        db.prepare(`
          UPDATE accounts
          SET amount = (amount + $amount)
          WHERE name = $to_account;
        `).run(data);
        }

    })
    
    doTransaction();
    res.status(200).json({ message: "Transaction added successfully" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;