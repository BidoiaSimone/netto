/* WHAT EACH TAG ADDS UP TO (Insights > Tags): what a trip (or any tag) cost, across every category.
 *
 *   spent       expenses with the tag
 *   received    incomes with the tag (a refund, money a friend paid back)
 *   net         received − spent: negative = what the trip cost you overall
 *   count       every transaction with the tag, movements included
 *   dates       the first and last transaction with the tag, next to the tag's own planned dates
 *   by category the spending (and income) inside the tag, split by category
 *
 * Only incomes and expenses are money in and out. A movement with the tag (cash withdrawn for the trip)
 * is counted but not spent: the cash is still yours until an expense says what it went on.
 * The whole history is used, not a period: a tag is already its own period.
 */

const db = require("../../db/databaseConnection.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

const selectTotalsOfEveryTag = db.prepare(`
  SELECT tg.id, tg.name, tg.start_date, tg.end_date,
         COUNT(t.id) AS transaction_count,
         COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS spent,
         COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount END), 0) AS received,
         MIN(t.date) AS first_date, MAX(t.date) AS last_date
  FROM tags tg
  LEFT JOIN transaction_tags tt ON tt.tag_id = tg.id
  LEFT JOIN transactions t ON t.id = tt.transaction_id
  GROUP BY tg.id
  ORDER BY COALESCE(tg.start_date, MIN(t.date)) DESC, tg.name COLLATE NOCASE
`);

// Grouped by category id, not name: an income "Gift" and an expense "Gift" are different categories
const selectTotalsByTagAndCategory = db.prepare(`
  SELECT tt.tag_id, t.type, t.category_id, COALESCE(c.name, 'Uncategorized') AS name,
         SUM(t.amount) AS total, COUNT(*) AS transaction_count
  FROM transaction_tags tt
  JOIN transactions t ON t.id = tt.transaction_id
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.type IN ('income', 'expense')
  GROUP BY tt.tag_id, t.type, t.category_id
  ORDER BY total DESC
`);

// Every tag, used or not, with its totals (euros). Newest trips first.
function buildTagReport() {
  const categoryRowsByTagId = new Map();
  for (const row of selectTotalsByTagAndCategory.all()) {
    if (!categoryRowsByTagId.has(row.tag_id)) categoryRowsByTagId.set(row.tag_id, []);
    categoryRowsByTagId.get(row.tag_id).push(row);
  }
  const toApiCategoryRow = (row) => ({ category_id: row.category_id, name: row.name, total: convertCentsToEuros(row.total), transaction_count: row.transaction_count });

  return selectTotalsOfEveryTag.all().map((tag) => {
    const categoryRows = categoryRowsByTagId.get(tag.id) ?? [];
    return {
      id: tag.id,
      name: tag.name,
      start_date: tag.start_date,
      end_date: tag.end_date,
      transaction_count: tag.transaction_count,
      spent: convertCentsToEuros(tag.spent),
      received: convertCentsToEuros(tag.received),
      net: convertCentsToEuros(tag.received - tag.spent), // subtracted in cents: exact
      first_date: tag.first_date,
      last_date: tag.last_date,
      expenses_by_category: categoryRows.filter((row) => row.type === "expense").map(toApiCategoryRow),
      income_by_category: categoryRows.filter((row) => row.type === "income").map(toApiCategoryRow),
    };
  });
}

module.exports = { buildTagReport };
