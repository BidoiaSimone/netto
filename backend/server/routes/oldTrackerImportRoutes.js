/* IMPORT FROM THE OLD TRACKER (Settings > Import from the old tracker…; services/oldTrackerImport.js)
 *   POST /import/old-tracker/preview  { csv, excluded? }  what would be imported: nothing is saved
 *   POST /import/old-tracker          { csv, excluded? }  imports it (a copy of the database is saved first)
 * The page sends the file's text both times: the server reads it again, so what's saved is exactly what was shown.
 * excluded: keys of the flagged lines left unticked in the preview.
 */

const express = require("express");
const { parseOldTrackerCsv } = require("../services/oldTrackerCsv.js");
const { buildImportPlan, applyImportPlan } = require("../services/oldTrackerImport.js");
const { saveDatabaseCopyBeforeImport } = require("../services/backupsFolder.js");
const { convertCentsToEuros: toEuros } = require("../utils/moneyConversion.js");

const router = express.Router();

// The plan in euros, as the page shows it
function planToApi(plan) {
  const history = plan.history_account;
  return {
    ...plan,
    lines: plan.lines.map((line) => ({ ...line, amount: toEuros(line.amount) })),
    history_account: {
      ...history,
      ...Object.fromEntries(["opening", "income", "spending", "adjustments", "invested", "moved_to_car", "before_hand_over", "difference", "later_recounts"]
        .map((key) => [key, toEuros(history[key])])),
      hand_overs: history.hand_overs.map((handOver) => ({ ...handOver, amount: toEuros(handOver.amount) })),
    },
    car: { ...plan.car, start_of_year: plan.car.start_of_year === undefined ? undefined : toEuros(plan.car.start_of_year),
      moves: plan.car.moves.map((move) => ({ ...move, amount: toEuros(move.amount) })) },
    investments: plan.investments.map((investment) => ({
      ...investment,
      openingAmount: investment.openingAmount === undefined ? undefined : toEuros(investment.openingAmount),
      cost: investment.cost === undefined ? undefined : toEuros(investment.cost),
      purchases: investment.purchases.map((purchase) => ({ ...purchase, amount: toEuros(purchase.amount) })),
    })),
    total_checks: plan.total_checks.map((check) => ({
      ...check, differences: check.differences.map((difference) => ({ ...difference, lines: toEuros(difference.lines), sheet: toEuros(difference.sheet) })),
    })),
  };
}

function readPlan(request) {
  const parsed = parseOldTrackerCsv(request.body?.csv);
  const excluded = Array.isArray(request.body?.excluded) ? request.body.excluded.map(String) : [];
  return buildImportPlan(parsed, { excluded });
}

router.post("/import/old-tracker/preview", function previewOldTrackerImport(request, response) {
  try {
    response.json(planToApi(readPlan(request)));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post("/import/old-tracker", async function importOldTracker(request, response) {
  let plan;
  try {
    plan = readPlan(request);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
  if (!plan.canImport) return response.status(409).json({ error: plan.blockers[0] ?? "nothing to import" });
  try {
    await saveDatabaseCopyBeforeImport();
  } catch (error) {
    return response.status(500).json({ error: "Could not save a safety copy, nothing was imported: " + error.message });
  }
  try {
    applyImportPlan(plan); // all or nothing
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
  response.json({ imported: plan.lines.filter((line) => !line.excluded).length, categories_created: plan.new_categories.length });
});

module.exports = router;
