// ---- the phone shows the essentials, the computer everything ----
// On a narrow screen (a phone, 800px or less: the same line as 31-phone.css) netto keeps to what's useful on the
// go: Home, Transactions, Insights (this month), Assets, Investments and Settings. Everything for sitting down and
// looking back (Recurring, Categories, Goals, Statements, Forecast, Year in review, the charts and
// trends of Insights, most of Settings) is marked class="desktop-only" in Home.html and stays on the computer.
//
// Like netto light (core/edition.js), the hiding is CSS (31-phone.css); this file is for what the JS decides:
// which pages can be opened. Settings > "On this phone" > Everything turns it off on that phone
// (<html data-phone-features="all">, set by themeBeforeFirstPaint.js, kept in this browser).

const phoneScreen = matchMedia("(max-width: 800px)");

export const isPhoneScreen = () => phoneScreen.matches;

const phoneShowsEverything = () => document.documentElement.dataset.phoneFeatures === "all";

// A part of the page left out on this screen (class="desktop-only", on it or on a parent)
export const isLeftOutOnThisScreen = (element) =>
  phoneScreen.matches && !phoneShowsEverything() && Boolean(element.closest(".desktop-only"));

// Calls back when the window crosses the phone / computer line (a Mac window made narrow, an iPad turned)
export const onScreenSizeChange = (callback) => phoneScreen.addEventListener("change", callback);

export function setPhoneFeatures(value) {
  document.documentElement.dataset.phoneFeatures = value;
  try { localStorage.setItem("phoneFeatures", value); } catch (error) {}
  window.dispatchEvent(new Event("netto:phone-features"));
}
