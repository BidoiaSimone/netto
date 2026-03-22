/* ROUTES CONVERGING FILE TO IMPORT JUST THIS FILE INTO app.js */

const express = require("express");

const router = express.Router();

// Connect routes from tables routes
router.use(require("./accounts.js"));
router.use(require("./transactions.js"));
router.use(require("./investments.js"));
router.use(require("./databaseQueries.js"));
router.use(require("./analytics.js"));

module.exports = router;