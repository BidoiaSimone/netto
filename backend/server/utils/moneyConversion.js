/* MONEY CONVERSIONS
 * The database stores every amount as integer cents; the API and the frontend speak euros.
 * These two functions are the only place where one becomes the other.
 */

// 12.34 or "12.34" -> 1234. Returns NaN for anything that isn't a number.
// The toPrecision step removes float noise first: 1.005 * 100 is 100.49999999999999 in floating
// point, which would round down to 100; as 15 significant digits it is 100.5, which rounds to 101.
function convertEurosToCents(euros) {
  if (euros === null || euros === undefined || euros === "") return NaN;
  const number = Number(euros);
  if (!Number.isFinite(number)) return NaN;
  return Math.round(Number((number * 100).toPrecision(15)));
}

// 1234 -> 12.34 (dividing an integer by 100 always gives the closest float to the right value).
// null and undefined pass through unchanged.
const convertCentsToEuros = (cents) => (cents == null ? cents : cents / 100);

// For messages shown to the user, formatted like the app does: 1.234,56 €
const euroCurrencyFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

module.exports = { convertEurosToCents, convertCentsToEuros, euroCurrencyFormatter };
