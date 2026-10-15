/* DATES, shared by every route that receives one. The API speaks "YYYY-MM-DD" in local time. */

// Local YYYY-MM-DD ("sv-SE" happens to format dates that way; toISOString would give the UTC date)
const getTodayAsLocalDate = () => new Date().toLocaleDateString("sv-SE");

// "2026-02-28" -> true, "2026-02-30" or "28/02/2026" -> false
function isRealCalendarDate(dateText) {
  if (typeof dateText !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return false;
  const parsedDate = new Date(dateText + "T00:00:00Z");
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().startsWith(dateText);
}

// No date given -> today. Returns null for an invalid date.
function parseDateOrDefaultToToday(dateText) {
  if (dateText === undefined || dateText === null || dateText === "") return getTodayAsLocalDate();
  return isRealCalendarDate(dateText) ? dateText : null;
}

// A timestamp safe to use in a file name: 2026-10-14T08-00-05-766Z
const getTimestampForFileName = () => new Date().toISOString().replace(/[:.]/g, "-");

module.exports = { getTodayAsLocalDate, isRealCalendarDate, parseDateOrDefaultToToday, getTimestampForFileName };
