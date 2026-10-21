/* YEAR IN REVIEW: GET /year-in-review?year=2026 (the current year when none is given), see services/yearInReview.js */

const express = require("express");
const { buildYearInReview, listYearsWithRecords } = require("../services/yearInReview.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");

const router = express.Router();

router.get("/year-in-review", async function getYearInReview(request, response) {
  const today = getTodayAsLocalDate();
  const year = request.query.year === undefined || request.query.year === "" ? Number(today.slice(0, 4)) : Number(request.query.year);
  if (!Number.isInteger(year)) return response.status(400).json({ error: "year must be a year, e.g. 2026" });
  if (!listYearsWithRecords(today).includes(year)) return response.status(400).json({ error: `No records for ${year}: netto has ${listYearsWithRecords(today).join(", ")}` });
  try {
    response.json(await buildYearInReview(year, { today }));
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

module.exports = router;
