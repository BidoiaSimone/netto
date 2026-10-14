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

module.exports = { findFirstRecordedDate };
