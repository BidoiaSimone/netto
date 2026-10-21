/* STATEMENTS (Statements page): income statement, balance sheet and net worth bridge for a period.
 * GET /statements?from=YYYY-MM-DD&to=YYYY-MM-DD   (see services/financialStatements.js)
 */

const express = require("express");
const { buildFinancialStatements } = require("../services/financialStatements.js");
const { parseDateOrDefaultToToday, getTodayAsLocalDate } = require("../utils/localDates.js");
const db = require("../../db/databaseConnection.js");
const { findFirstDayOfAnyRecord } = require("../../db/firstRecordedDate.js");

const router = express.Router();

router.get("/statements", async function getStatements(request, response) {
  const today = getTodayAsLocalDate();
  let from = parseDateOrDefaultToToday(request.query.from);
  let to = parseDateOrDefaultToToday(request.query.to);
  if (!from || !to) return response.status(400).json({ error: "from and to must be valid YYYY-MM-DD dates" });
  if (to > today) to = today; // nothing has happened after today yet
  if (from > to) return response.status(400).json({ error: "the period must start on or before its last day (and not in the future)" });
  // "All time" asks from 1970. Before the first record everything is 0, which changes nothing in the balance sheet,
  // but the maths that counts days would: 56 years of stamp duty, an average balance diluted over decades, returns
  // spread over 20,000 days. So a period never starts before the first record (unless it ends before it too).
  const firstDayOfRecords = findFirstDayOfAnyRecord(db);
  if (from < firstDayOfRecords && firstDayOfRecords <= to) from = firstDayOfRecords;

  try {
    response.json(await buildFinancialStatements(from, to));
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

module.exports = router;
