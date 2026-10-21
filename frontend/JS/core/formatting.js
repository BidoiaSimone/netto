// ---- how numbers and dates are shown (Italian style: 1.234,56 €) ----

// ---- Hide amounts (privacy mode): amounts become ***** € ----
// Every amount on the page is written by one of the formatters below, so they check the switch themselves:
// while amounts are hidden they write ***** € instead (always five stars, so not even the number of digits
// shows). Percentages, dates and the shapes of the charts stay as they are: you can still see how things are
// going, just not how much money that is. Turning the switch reloads every page (settings/privacyMode.js).
// Single transactions are the exception, as before the switch hid them: the Transactions and Recurring pages,
// the latest transactions on Home and the add / edit windows use the visible... formatters, so you can still
// add and check them in public.
let amountsHidden = false;
export const setAmountsHidden = (hidden) => { amountsHidden = hidden; };
export const areAmountsHidden = () => amountsHidden;
export const HIDDEN_AMOUNT = "*****";

// A formatter that writes ***** € (or ***** for a number of shares) while amounts are hidden
export function hideWhenAmountsHidden(formatter, hiddenText = `${HIDDEN_AMOUNT} €`) {
  return { format: (number) => (amountsHidden ? hiddenText : formatter.format(number)) };
}

export const visibleEuroFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
export const euroFormatter = hideWhenAmountsHidden(visibleEuroFormatter);
export const wholeEuroFormatter = hideWhenAmountsHidden(new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));
// how many shares you hold says how much they're worth, once you know the price
export const shareCountFormatter = hideWhenAmountsHidden(new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 }), HIDDEN_AMOUNT);
// a price per share is the market's, not yours: always shown
export const pricePerShareFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });

const signOf = (number) => (number > 0 ? "+" : number < 0 ? "−" : "");

// +12,50 € / −12,50 € (a real minus sign)
export const formatSignedEuros = (number) => signOf(number) + euroFormatter.format(Math.abs(number));
// +13 € / −13 €
export const formatSignedWholeEuros = (number) => signOf(number) + wholeEuroFormatter.format(Math.abs(number));
// +4.2% / −4.2%
export const formatSignedPercent = (number) => signOf(number) + Math.abs(number).toFixed(1) + "%";
// Reconciliation differences: "+" added only to positive amounts, negatives keep the formatter's own "-"
export const formatDifferenceWithPlusSign = (difference) => (difference > 0 ? "+" : "") + euroFormatter.format(difference);

// "3 transactions", "1 transaction"
export const formatCount = (count, singularWord) => `${count} ${singularWord}${count === 1 ? "" : "s"}`;

// "2026-10-14" -> "14 ott" (or "14 ott 26" with the year)
export const formatShortDate = (dateText, withYear) =>
  new Date(dateText + "T00:00").toLocaleDateString("it-IT", withYear ? { day: "numeric", month: "short", year: "2-digit" } : { day: "numeric", month: "short" });

// Local YYYY-MM-DD ("sv-SE" happens to format dates that way; toISOString would give the UTC date)
export const getTodayAsLocalDate = () => new Date().toLocaleDateString("sv-SE");

// Local YYYY-MM-DD some days from today (negative = in the past)
export function getLocalDateDaysFromToday(dayOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date.toLocaleDateString("sv-SE");
}

// Counts up (or down) to a new amount instead of jumping
export function animateEuroAmount(element, targetAmount) {
  const startAmount = element._shownAmount ?? 0;
  const startTime = performance.now();
  element._shownAmount = targetAmount;
  (function drawFrame(now) {
    const progress = Math.min((now - startTime) / 700, 1);
    const easedProgress = 1 - (1 - progress) ** 3;
    element.textContent = euroFormatter.format(startAmount + (targetAmount - startAmount) * easedProgress);
    if (progress < 1) requestAnimationFrame(drawFrame);
  })(startTime);
}
