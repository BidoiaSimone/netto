/* NET WORTH (sidebar and Home page) and its history (Insights page) */

const express = require("express");
const { calculateNetWorth } = require("../services/netWorthCalculator.js");
const { getNetWorthHistory } = require("../services/netWorthHistory.js");

const router = express.Router();

router.get("/net-worth", async function getNetWorth(request, response) {
  try {
    response.json(await calculateNetWorth());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

// Net worth on every day of a period, split into accounts and investments. ?range=1m|6m|1y|all
router.get("/net-worth/history", async function getNetWorthOverTime(request, response) {
  try {
    response.json(await getNetWorthHistory(request.query.range));
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

module.exports = router;
