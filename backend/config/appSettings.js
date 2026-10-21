/* THE SETTINGS STORED IN THE DATABASE (app_settings, migration 15)
 * Preferences that belong with your data rather than with one browser, so they also travel in the JSON backup.
 * (Theme, colour and "hide amounts" stay in the browser: they're about the screen, not the money.)
 * Every setting is a number with a default and an allowed range; the API refuses anything outside it.
 */

const APP_SETTING_DEFINITIONS = {
  // Investments > Target allocation: a ticker whose share is this many percentage points away from its
  // target is highlighted
  allocation_drift_threshold_points: { default: 5, minimum: 0.5, maximum: 50, description: "Highlight a drift from this many percentage points" },

  // Insights > Category trends: a category is "running hot" when this month is above its usual average by
  // BOTH this share and this amount, so a 3 € category going to 5 € doesn't get flagged
  trend_highlight_share: { default: 0.25, minimum: 0.05, maximum: 3, description: "Above the average by at least this share (0.25 = 25%)" },
  trend_highlight_minimum_euros: { default: 20, minimum: 0, maximum: 10000, description: "…and by at least this many euros" },
  // 1 = leave out transactions tagged with a trip (a tag with dates) when working out the usual average
  trend_exclude_trips: { default: 1, minimum: 0, maximum: 1, isWholeNumber: true, description: "Leave trips out of the average" },

  // Reconciliation reminders: how many days an account can go without being counted.
  // 0 = never remind. Closed accounts and personal-use assets (the car) are never reminded about.
  reconcile_every_days_everyday: { default: 28, minimum: 0, maximum: 730, isWholeNumber: true, description: "Cash, current accounts and vouchers: every this many days" },
  reconcile_every_days_savings: { default: 91, minimum: 0, maximum: 730, isWholeNumber: true, description: "Savings accounts: every this many days" },

  // Forecast > FIRE number: the share of your invested money you'd take out each year (0.035 = 3.5%), and which
  // yearly expenses it has to cover: 0 = the plan's last phase (e.g. "Working"), 1 = your real last 12 months
  fire_withdrawal_rate: { default: 0.035, minimum: 0.02, maximum: 0.06, description: "Safe withdrawal rate (0.035 = 3.5% a year)" },
  fire_expenses_from_last_12_months: { default: 0, minimum: 0, maximum: 1, isWholeNumber: true, description: "1 = use the last 12 months' real expenses" },

  // Backups: 1 = also copy each daily backup to iCloud Drive (services/automaticDailyBackups.js), so a lost or
  // broken Mac doesn't take the data with it
  backup_copy_offsite: { default: 1, minimum: 0, maximum: 1, isWholeNumber: true, description: "Also keep a copy of each daily backup in iCloud Drive" },

  // Home > the month's wrap-up (services/monthWrapUp.js): the last month already closed, as 202610 for October 2026
  month_wrap_up_dismissed: { default: 0, minimum: 0, maximum: 999912, isWholeNumber: true, description: "Last month whose wrap-up was closed (YYYYMM)" },
};

// { key: value } with every setting, the stored value or its default
function buildSettingsWithDefaults(storedRows) {
  const storedValueByKey = new Map(storedRows.map((row) => [row.key, JSON.parse(row.value)]));
  return Object.fromEntries(Object.entries(APP_SETTING_DEFINITIONS).map(([key, definition]) => [key, storedValueByKey.get(key) ?? definition.default]));
}

// Returns { error } or { value } for one setting sent by the frontend
function validateSettingValue(key, value) {
  const definition = APP_SETTING_DEFINITIONS[key];
  if (!definition) return { error: `Unknown setting: ${key}` };
  const number = Number(value); // true -> 1, "5" -> 5
  if (value === null || value === "" || !Number.isFinite(number)) return { error: `${key} must be a number` };
  if (number < definition.minimum || number > definition.maximum) return { error: `${key} must be between ${definition.minimum} and ${definition.maximum}` };
  if (definition.isWholeNumber && !Number.isInteger(number)) return { error: `${key} must be a whole number` };
  return { value: number };
}

module.exports = { APP_SETTING_DEFINITIONS, buildSettingsWithDefaults, validateSettingValue };
