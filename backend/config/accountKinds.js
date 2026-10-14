/* ACCOUNT KINDS AND HOW LIQUID EACH ONE IS
 * Every account has a kind, and every kind belongs to one liquidity class: how quickly, and how surely,
 * its value can become money you can spend. The classes follow the usual order of a personal balance
 * sheet, from most to least liquid:
 *
 *   cash_and_equivalents  cash, current and savings accounts: spendable today, at exactly that value
 *   restricted            restricted cash, e.g. meal vouchers: real money, but only for some purchases
 *   investments           marketable securities (the Investments page, not an account kind): a few days
 *                         to sell, at whatever the market pays that day
 *   personal_use          personal-use assets, e.g. a car: only money once sold, at a price you can
 *                         only estimate
 *
 * The frontend keeps the same list for its labels (frontend/JS/core/accountKinds.js): change both together.
 * The database only accepts these kinds (migration 9): adding one needs a new migration too.
 */

const ACCOUNT_KINDS = {
  cash: { label: "Cash", liquidity: "cash_and_equivalents" },
  bank: { label: "Current account", liquidity: "cash_and_equivalents" },
  savings: { label: "Savings account", liquidity: "cash_and_equivalents" },
  restricted: { label: "Restricted (vouchers)", liquidity: "restricted" },
  asset: { label: "Personal-use asset", liquidity: "personal_use" },
};

const ACCOUNT_KIND_NAMES = Object.keys(ACCOUNT_KINDS);

module.exports = { ACCOUNT_KINDS, ACCOUNT_KIND_NAMES };
