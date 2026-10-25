/* RECONCILIATION REMINDERS: which accounts haven't been counted for too long (Home)
 *
 * netto's balances are only as right as the last time you checked them against reality. Each account is due again
 * a number of days after its last reconciliation (accounts.last_reconciled, set by Assets > Reconcile and when an
 * account is created). How many days depends on how fast the account moves; both are settings:
 *
 *   cash, current accounts, vouchers   reconcile_every_days_everyday   default 28 (every 4 weeks)
 *   savings accounts                   reconcile_every_days_savings    default 91 (every 3 months)
 *   personal-use assets (the car)      never: their value is an estimate, there's nothing to count
 *   closed accounts                    never
 * A setting at 0 turns that group's reminders off.
 *
 * An account is due when that many days have passed (on day 28 for "every 28 days"); never reconciled = due.
 */

const db = require("../../db/databaseConnection.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { readAllSettings } = require("./appSettings.js");

const SETTING_KEY_BY_KIND = {
  cash: "reconcile_every_days_everyday",
  bank: "reconcile_every_days_everyday",
  restricted: "reconcile_every_days_everyday",
  savings: "reconcile_every_days_savings",
  asset: null,
};

const MILLISECONDS_PER_DAY = 864e5;
const countDaysBetween = (fromDate, toDate) => Math.round((Date.parse(toDate + "T00:00:00Z") - Date.parse(fromDate + "T00:00:00Z")) / MILLISECONDS_PER_DAY);

// How often an account should be reconciled, in days; null = never reminded
function findReconcileInterval(account, settings) {
  if (account.closed_at) return null;
  const settingKey = SETTING_KEY_BY_KIND[account.kind];
  const everyDays = settingKey ? settings[settingKey] : 0;
  return everyDays > 0 ? everyDays : null;
}

// Every open account that is due, the longest overdue first (never reconciled before everything else):
// [{ account_id, name, kind, balance, last_reconciled, days_since, every_days, overdue_days }]
function listAccountsToReconcile({ today = getTodayAsLocalDate(), settings = readAllSettings() } = {}) {
  const accounts = db.prepare(`SELECT id, name, kind, balance, last_reconciled, closed_at FROM accounts`).all();
  return accounts
    .map((account) => {
      const everyDays = findReconcileInterval(account, settings);
      if (everyDays === null) return null;
      const daysSince = account.last_reconciled ? countDaysBetween(account.last_reconciled, today) : null;
      if (daysSince !== null && daysSince < everyDays) return null;
      return {
        account_id: account.id,
        name: account.name,
        kind: account.kind,
        balance: account.balance / 100,
        last_reconciled: account.last_reconciled,
        days_since: daysSince,
        every_days: everyDays,
        overdue_days: daysSince === null ? null : daysSince - everyDays,
      };
    })
    .filter(Boolean)
    .sort((first, second) => (second.overdue_days ?? Infinity) - (first.overdue_days ?? Infinity) || first.name.localeCompare(second.name));
}

module.exports = { listAccountsToReconcile, findReconcileInterval };
