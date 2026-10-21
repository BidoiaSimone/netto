/* MIGRATION 13. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 13: forecast events that move money between cash and investments ----
// Until now an event's money either arrived from outside (+, selling the car) or left for good (−, a new laptop).
// Investing 5,000 € isn't either: the money stays yours, it only changes place. Modelled as a plain −5,000 €
// event, the forecast got the cash right but showed the net worth 5,000 € too low, and never let that money grow.
//
// transfers_with_investments = 1 marks such an event:
//   − amount   cash -> investments (buying ETFs): cash goes down, investments go up by the same amount
//   + amount   investments -> cash (selling ETFs): investments go down, cash goes up
// Existing events keep 0, so they mean exactly what they meant before.
// An event can't both sell the car and move investments; the API refuses that combination.
function addTransfersWithInvestmentsToForecastEvents(db) {
  db.exec(`
    ALTER TABLE forecast_events
      ADD COLUMN transfers_with_investments INTEGER NOT NULL DEFAULT 0 CHECK (transfers_with_investments IN (0, 1));
  `);
}

module.exports = addTransfersWithInvestmentsToForecastEvents;
