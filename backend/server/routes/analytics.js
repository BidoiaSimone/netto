const express = require("express");
const db = require("../../db/database.js");

const router = express.Router();


// INSERT ALSO INVESTMENTS IN THE NET-WORTH
router.get('/net-worth', function (req, res) {

    const rows = db.prepare(`SELECT SUM(amount) AS net_worth FROM accounts`).all();

    res.json(rows);
});

module.exports = router;