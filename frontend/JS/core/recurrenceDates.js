// ---- dates and descriptions of recurring transactions ----
// The date arithmetic is the same as the server's (backend/server/services/recurrenceSchedule.js), so the
// dialog can preview the next dates before saving. The server stays the one that decides what is added.

const ORDINAL_SUFFIXES = { one: "st", two: "nd", few: "rd", other: "th" };
const englishOrdinalRules = new Intl.PluralRules("en", { type: "ordinal" });
const toOrdinal = (number) => `${number}${ORDINAL_SUFFIXES[englishOrdinalRules.select(number)]}`; // 1st, 2nd, 23rd

const parseDateParts = (dateText) => dateText.split("-").map(Number);
const padTwoDigits = (number) => String(number).padStart(2, "0");
const countDaysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function addDays(dateText, numberOfDays) {
  const [year, month, day] = parseDateParts(dateText);
  return new Date(Date.UTC(year, month - 1, day + numberOfDays)).toISOString().slice(0, 10);
}

// Keeps the day of the month, moved to the month's last day when the month is shorter (31 Jan -> 28 Feb)
function addMonthsKeepingDay(dateText, numberOfMonths) {
  const [year, month, day] = parseDateParts(dateText);
  const monthIndex = (month - 1) + numberOfMonths;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  return `${targetYear}-${padTwoDigits(targetMonth)}-${padTwoDigits(Math.min(day, countDaysInMonth(targetYear, targetMonth)))}`;
}

// The date of occurrence number `occurrenceIndex` of a schedule (0 = the start date)
export function getOccurrenceDate({ start_date: startDate, repeat_unit: repeatUnit, repeat_interval: repeatInterval }, occurrenceIndex) {
  const steps = occurrenceIndex * repeatInterval;
  if (repeatUnit === "week") return addDays(startDate, steps * 7);
  if (repeatUnit === "month") return addMonthsKeepingDay(startDate, steps);
  return addMonthsKeepingDay(startDate, steps * 12);
}

// The next `count` dates on or after `fromDate` (stopping at the end date)
export function listUpcomingDates(schedule, fromDate, count) {
  const upcomingDates = [];
  for (let index = 0; upcomingDates.length < count && index < 5000; index++) {
    const date = getOccurrenceDate(schedule, index);
    if (schedule.end_date && date > schedule.end_date) break;
    if (date >= fromDate) upcomingDates.push(date);
  }
  return upcomingDates;
}

// How many times a year it happens, to show what a rule costs per month
const OCCURRENCES_PER_YEAR_BY_UNIT = { week: 52, month: 12, year: 1 };
export const calculateMonthlyEquivalent = (rule) => (rule.amount * OCCURRENCES_PER_YEAR_BY_UNIT[rule.repeat_unit]) / rule.repeat_interval / 12;

// "Every month on the 5th", "Every 2 weeks on Wednesday", "Every year on 14 October"
export function describeRepeat({ start_date: startDate, repeat_unit: repeatUnit, repeat_interval: repeatInterval }) {
  const start = new Date(startDate + "T00:00");
  const every = repeatInterval === 1 ? `Every ${repeatUnit}` : `Every ${repeatInterval} ${repeatUnit}s`;
  if (repeatUnit === "week") return `${every} on ${start.toLocaleDateString("en-GB", { weekday: "long" })}`;
  if (repeatUnit === "year") return `${every} on ${start.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
  const dayOfMonth = start.getDate();
  return `${every} on the ${toOrdinal(dayOfMonth)}${dayOfMonth > 28 ? " (or the month's last day)" : ""}`;
}
