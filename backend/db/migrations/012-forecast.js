/* MIGRATION 12. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 12: the Forecast page (phases, one-off events, assumptions) ----
// A forecast of net worth needs to know what your months will look like, and they won't all look the same
// (a master's degree with little income, then a job). So the plan is a list of PHASES, each with a monthly
// income and monthly expenses, plus one-off EVENTS (selling the car), plus the ASSUMPTIONS (return, inflation...).
//
// A phase only says when it STARTS (from_month): it lasts until the next one starts, and the earliest one also
// covers today. That way phases can never overlap or leave a gap, whatever order they are edited in.
// Phase amounts are in today's euros (what a month costs now); the simulation raises them with inflation.
// Events are in the euros of their month (what you expect to get for the car then).
//
// The assumptions are one row (id is always 1), created here with the defaults, so the page always has some.
function createForecastTables(db) {
  db.exec(`
    CREATE TABLE forecast_phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      from_month TEXT NOT NULL UNIQUE CHECK (from_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),  -- YYYY-MM, one phase per start month
      monthly_income INTEGER NOT NULL DEFAULT 0 CHECK (monthly_income >= 0),       -- cents, today's euros
      monthly_expenses INTEGER NOT NULL DEFAULT 0 CHECK (monthly_expenses >= 0)    -- cents, today's euros
    );

    CREATE TABLE forecast_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
      amount INTEGER NOT NULL CHECK (amount <> 0),        -- cents: + money in (selling the car), − money out (a new laptop)
      -- optional: the personal-use asset this event sells. Its value leaves the forecast that month (the money
      -- replaces it), so the car isn't counted twice. A deleted account just stops being linked.
      sells_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL
    );

    CREATE TABLE forecast_assumptions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      yearly_return REAL NOT NULL DEFAULT 0.05,         -- investments: 0.05 = 5% a year
      yearly_inflation REAL NOT NULL DEFAULT 0.02,      -- also turns the results into today's euros
      savings_go_to TEXT NOT NULL DEFAULT 'cash' CHECK (savings_go_to IN ('cash', 'investments')),
      yearly_depreciation REAL NOT NULL DEFAULT 0.15    -- personal-use assets (the car) lose this much a year
    );
    INSERT INTO forecast_assumptions (id) VALUES (1);
  `);
}

module.exports = createForecastTables;
