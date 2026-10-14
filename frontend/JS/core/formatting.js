// ---- how numbers and dates are shown (Italian style: 1.234,56 €) ----

export const euroFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
export const wholeEuroFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const shareCountFormatter = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 });
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
