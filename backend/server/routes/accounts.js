const express = require("express");
const db = require("../../db/database.js");

const router = express.Router();

router.get('/accounts', function (req, res) {

  const rows = db.prepare(`SELECT * FROM accounts`).all();

  res.json(rows);
});

router.post('/accounts', function (req, res) {
  try {
    const query = db.prepare(`
      INSERT INTO accounts (name, amount, open_date)
      VALUES ($name, $amount, $open_date)
    `);

    req.body.open_date = new Date().toISOString().split('T')[0];

    query.run(req.body);

    res.status(200).json({ message: "Account added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;