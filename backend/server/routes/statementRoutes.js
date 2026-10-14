/* STATEMENTS (Statements page): income statement, balance sheet and net worth bridge for a period.
 * GET /statements?from=YYYY-MM-DD&to=YYYY-MM-DD   (see services/financialStatements.js)
 */

const express = require("express");
const { buildFinancialStatements } = require("../services/financialStatements.js");
const { parseDateOrDefaultToToday, getTodayAsLocalDate } = require("../utils/localDates.js");

const router = express.Router();

router.get("/statements", async function getStatements(request, response) {
  const today = getTodayAsLocalDate();
  const from = parseDateOrDefaultToToday(request.query.from);
  let to = parseDateOrDefaultToToday(request.query.to);
  if (!from || !to) return response.status(400).json({ error: "from and to must be valid YYYY-MM-DD dates" });
  if (to > today) to = today; // nothing has happened after today yet
  if (from > to) return response.status(400).json({ error: "the period must start on or before its last day (and not in the future)" });

  try {
    response.json(await buildFinancialStatements(from, to));
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

module.exports = router;
