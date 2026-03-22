const express = require("express");
const db = require("../../db/database.js");
const chalk = require("chalk");

const router = express.Router();

router.get('/database', function(req, res) {

    var jsonRes = {};

    jsonRes.accounts = db.prepare(`SELECT * FROM accounts`).all();
    jsonRes.investments = db.prepare(`SELECT * FROM investments`).all();
    jsonRes.transactions = db.prepare(`SELECT * FROM transactions`).all();

    console.log(chalk.blue("\nAccounts:"));
    console.log(JSON.stringify(jsonRes.accounts, null, 2));

    console.log(chalk.blue("\nTransactions:"));
    console.log(JSON.stringify(jsonRes.transactions, null, 2));

    console.log(chalk.blue("\nInvestments:"));
    console.log(JSON.stringify(jsonRes.investments, null, 2));
    res.json(jsonRes);
});

module.exports = router;