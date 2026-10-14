/* RECURRENCE DATES
 * Works out the dates of a recurring transaction: start date + every N weeks, months or years.
 * Pure date arithmetic on "YYYY-MM-DD" text, no database. Months keep the start's day of the month,
 * moved to the last day when a month is shorter: a rule starting on 31 Jan falls on 28 Feb (29 in a
 * leap year), 31 Mar, 30 Apr... Yearly rules starting on 29 Feb fall on 28 Feb in other years.
 */

const REPEAT_UNITS = ["week", "month", "year"];

const parseDateParts = (dateText) => dateText.split("-").map(Number); // "2026-10-14" -> [2026, 10, 14]
const padTwoDigits = (number) => String(number).padStart(2, "0");
const formatDateParts = (year, month, day) => `${year}-${padTwoDigits(month)}-${padTwoDigits(day)}`;
const countDaysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12

function addDays(dateText, numberOfDays) {
  const [year, month, day] = parseDateParts(dateText);
  return new Date(Date.UTC(year, month - 1, day + numberOfDays)).toISOString().slice(0, 10);
}

function addMonthsKeepingDay(dateText, numberOfMonths) {
  const [year, month, day] = parseDateParts(dateText);
  const monthIndex = (month - 1) + numberOfMonths;           // months counted from January of `year`
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  return formatDateParts(targetYear, targetMonth, Math.min(day, countDaysInMonth(targetYear, targetMonth)));
}

// The date of occurrence number `occurrenceIndex` (0 = the start date itself)
function getOccurrenceDate({ start_date: startDate, repeat_unit: repeatUnit, repeat_interval: repeatInterval }, occurrenceIndex) {
  const steps = occurrenceIndex * repeatInterval;
  if (repeatUnit === "week") return addDays(startDate, steps * 7);
  if (repeatUnit === "month") return addMonthsKeepingDay(startDate, steps);
  if (repeatUnit === "year") return addMonthsKeepingDay(startDate, steps * 12);
  throw new Error(`Unknown repeat unit: ${repeatUnit}`);
}

// How many occurrences fall on or before `lastDate` (0 when the schedule starts after it)
function countOccurrencesUpTo(schedule, lastDate) {
  let count = 0;
  while (getOccurrenceDate(schedule, count) <= lastDate) count++;
  return count;
}

// The next date not turned into a transaction yet, or null when the rule has ended
function getNextOccurrenceDate(rule) {
  const nextDate = getOccurrenceDate(rule, rule.posted_count);
  return rule.end_date && nextDate > rule.end_date ? null : nextDate;
}

module.exports = { REPEAT_UNITS, getOccurrenceDate, countOccurrencesUpTo, getNextOccurrenceDate, addMonthsKeepingDay };
