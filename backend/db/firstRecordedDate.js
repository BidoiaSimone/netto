/* THE FIRST DAY ANYTHING WAS RECORDED
 * Holdings that existed before trades were tracked become one "opening position" buy each, dated
 * here (migration 4 and the import of old backups): the real purchase dates aren't known, and dating
 * them today would make any back-dated sell look like selling shares not yet bought.
 */

// The earliest account opening or transaction date (today on an empty database)
function findFirstRecordedDate(db) {
  const row = db.prepare(`
    SELECT MIN(d) AS d FROM (SELECT MIN(open_date) AS d FROM accounts UNION ALL SELECT MIN(date) FROM transactions)
  `).get();
  return row.d ?? new Date().toLocaleDateString("sv-SE");
}

// The first day anything happened at all: an account opening, a transaction or a trade. Statements and the Year in
// review never start a period before it (see routes/statementRoutes.js for why).
function findFirstDayOfAnyRecord(db) {
  const firstTradeDay = db.prepare(`SELECT MIN(date) AS day FROM investment_trades`).get().day;
  const firstOtherDay = findFirstRecordedDate(db);
  return firstTradeDay && firstTradeDay < firstOtherDay ? firstTradeDay : firstOtherDay;
}

module.exports = { findFirstRecordedDate, findFirstDayOfAnyRecord };
