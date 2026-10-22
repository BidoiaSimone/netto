/* THE LIST OF MIGRATIONS, IN THE ORDER THEY RUN
 * Position in this list = migration number (the first one is 1). SQLite remembers the number of the
 * last one applied (PRAGMA user_version), so the order must never change: only append new ones.
 */

const allMigrationsInOrder = [
  require("./001-baseline.js"),
  require("./002-integer-ids-and-cents.js"),
  require("./003-stored-balance-with-triggers.js"),
  require("./004-investment-trades.js"),
  require("./005-todos-table.js"),
  require("./006-closed-accounts.js"),
  require("./007-recurring-transactions.js"),
  require("./008-category-kinds.js"),
  require("./009-restricted-account-kind.js"),
  require("./010-tags.js"),
  require("./011-category-budgets.js"),
  require("./012-forecast.js"),
  require("./013-forecast-events-with-investments.js"),
  require("./014-foreign-currency-amounts.js"),
  require("./015-investment-targets-and-settings.js"),
  require("./016-category-spending-pace.js"),
  require("./017-savings-goals.js"),
  require("./018-offline-submissions.js"),
  require("./019-old-tracker-account-is-cash.js"),
  require("./020-last-known-prices.js"),
  require("./021-category-icons-and-colors.js"),
  require("./022-income-linked-to-goals.js"),
];

const LATEST_DATABASE_VERSION = allMigrationsInOrder.length;

module.exports = { allMigrationsInOrder, LATEST_DATABASE_VERSION };
