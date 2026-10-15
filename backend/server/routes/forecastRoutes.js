/* FORECAST (Forecast page): the simulation, and the plan behind it (phases, one-off events, assumptions).
 * Every change answers with the whole new forecast, so the page redraws from one request.
 * The maths: services/forecastSimulation.js; the data around it: services/forecast.js.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { buildForecast } = require("../services/forecast.js");
const { validatePhase, validateEvent, validateAssumptions } = require("../validation/forecastValidation.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { sendErrorResponse } = require("../utils/httpErrors.js");

const router = express.Router();

const ALLOWED_YEARS = [1, 2, 5, 10];

async function answerWithForecast(request, response, status = 200) {
  const requestedYears = Number(request.query.years);
  const years = ALLOWED_YEARS.includes(requestedYears) ? requestedYears : 10;
  try {
    response.status(status).json(await buildForecast(getTodayAsLocalDate(), { years }));
  } catch (error) {
    sendErrorResponse(response, error);
  }
}

// GET /forecast?years=1|2|5|10
router.get("/forecast", (request, response) => answerWithForecast(request, response));

// ---------- assumptions (one row) ----------

router.put("/forecast/assumptions", (request, response) => {
  const { error, changes } = validateAssumptions(request.body);
  if (error) return response.status(400).json({ error });
  const columns = Object.keys(changes);
  if (columns.length) {
    // the column names come from validateAssumptions' fixed list, never from the request
    db.prepare(`UPDATE forecast_assumptions SET ${columns.map((column) => `${column} = @${column}`).join(", ")} WHERE id = 1`).run(changes);
  }
  answerWithForecast(request, response);
});

// ---------- phases ----------

const SAME_START_MONTH = "Another phase already starts that month: each phase starts in its own month";

router.post("/forecast/phases", (request, response) => {
  const { error, phase } = validatePhase(request.body);
  if (error) return response.status(400).json({ error });
  try {
    db.prepare(`INSERT INTO forecast_phases (name, from_month, monthly_income, monthly_expenses) VALUES (?, ?, ?, ?)`)
      .run(phase.name, phase.fromMonth, phase.monthlyIncome, phase.monthlyExpenses);
  } catch (insertError) {
    if (insertError.code === "SQLITE_CONSTRAINT_UNIQUE") return response.status(409).json({ error: SAME_START_MONTH });
    throw insertError;
  }
  answerWithForecast(request, response, 201);
});

router.put("/forecast/phases/:id", (request, response) => {
  const { error, phase } = validatePhase(request.body);
  if (error) return response.status(400).json({ error });
  try {
    const { changes } = db.prepare(`UPDATE forecast_phases SET name = ?, from_month = ?, monthly_income = ?, monthly_expenses = ? WHERE id = ?`)
      .run(phase.name, phase.fromMonth, phase.monthlyIncome, phase.monthlyExpenses, Number(request.params.id));
    if (!changes) return response.status(404).json({ error: "Phase not found" });
  } catch (updateError) {
    if (updateError.code === "SQLITE_CONSTRAINT_UNIQUE") return response.status(409).json({ error: SAME_START_MONTH });
    throw updateError;
  }
  answerWithForecast(request, response);
});

router.delete("/forecast/phases/:id", (request, response) => {
  const { changes } = db.prepare(`DELETE FROM forecast_phases WHERE id = ?`).run(Number(request.params.id));
  if (!changes) return response.status(404).json({ error: "Phase not found" });
  answerWithForecast(request, response);
});

// ---------- one-off events ----------

router.post("/forecast/events", (request, response) => {
  const { error, event } = validateEvent(request.body);
  if (error) return response.status(400).json({ error });
  db.prepare(`INSERT INTO forecast_events (name, month, amount, sells_account_id) VALUES (?, ?, ?, ?)`)
    .run(event.name, event.month, event.amount, event.sellsAccountId);
  answerWithForecast(request, response, 201);
});

router.put("/forecast/events/:id", (request, response) => {
  const { error, event } = validateEvent(request.body);
  if (error) return response.status(400).json({ error });
  const { changes } = db.prepare(`UPDATE forecast_events SET name = ?, month = ?, amount = ?, sells_account_id = ? WHERE id = ?`)
    .run(event.name, event.month, event.amount, event.sellsAccountId, Number(request.params.id));
  if (!changes) return response.status(404).json({ error: "Event not found" });
  answerWithForecast(request, response);
});

router.delete("/forecast/events/:id", (request, response) => {
  const { changes } = db.prepare(`DELETE FROM forecast_events WHERE id = ?`).run(Number(request.params.id));
  if (!changes) return response.status(404).json({ error: "Event not found" });
  answerWithForecast(request, response);
});

module.exports = router;
