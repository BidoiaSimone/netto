// ---- privacy mode: every amount becomes ***** € except single transactions (see core/formatting.js) ----
// The formatters write the stars, so switching it redraws every page (loadAllData). Switching it on also swaps
// every amount already on screen for stars straight away (starAmountsOnScreen), so the old amounts never stay
// readable while the pages load again.
// Settings > Hide amounts: "always" = hidden after every load (default),
// "open" = a reload keeps the current state, but opening the app again starts hidden.
// The current state lives in sessionStorage: it survives reloads and is wiped when the window closes.
//
// Hiding again by itself: with amounts shown, netto hides them after AUTO_HIDE minutes without a tap, click, key or
// scroll (Settings > Hide again after, per device: off, 2, 10 or 30; 10 by default). Meant for the app left open on
// the phone or the Mac: put away with amounts showing, it opens later with them hidden. A phone suspends a page in the
// background, so its timers don't run there: the time is checked again the moment the app comes back to the front,
// and the stars are put in before anything else happens.

import { elementById, highlightSelectedChip } from "../core/domHelpers.js";
import { setAmountsHidden, HIDDEN_AMOUNT } from "../core/formatting.js";
import { loadAllData } from "../core/dataRefresh.js";

let privacyOnLoadSetting = localStorage.getItem("privacyOnLoad") || "always";

const AUTO_HIDE_STORAGE_KEY = "privacyAutoHideMinutes";
const DEFAULT_AUTO_HIDE_MINUTES = 10;
const AUTO_HIDE_CHECK_EVERY_MILLISECONDS = 15000;
const readAutoHideMinutes = () => {
  try { return Number(localStorage.getItem(AUTO_HIDE_STORAGE_KEY) ?? DEFAULT_AUTO_HIDE_MINUTES); } catch { return DEFAULT_AUTO_HIDE_MINUTES; }
};
let autoHideMinutes = readAutoHideMinutes(); // 0 = never
let lastActivityTime = Date.now();

export const isPrivacyModeOn = () => document.body.classList.contains("private");

// "12.345,67 €", "1300,00 €", "−13 €", "+0,60 €": any euro amount written the Italian way. Italian groups
// thousands only from five digits on (1300,00 € but 12.300,00 €), so the first group can be any length.
const EURO_AMOUNT_PATTERN = /[−+-]?\d+(?:\.\d{3})*(?:,\d+)?\s?€/g;

// Every euro amount in the page's text (charts included) becomes ***** € at once. The redraw that follows puts
// back the ones that stay visible (single transactions).
function starAmountsOnScreen() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue.includes("€")) node.nodeValue = node.nodeValue.replace(EURO_AMOUNT_PATTERN, `${HIDDEN_AMOUNT} €`);
  }
}

// redrawPages: false only at startup, where the first load draws everything anyway
export async function setPrivacyMode(shouldHideAmounts, { redrawPages = true } = {}) {
  setAmountsHidden(shouldHideAmounts);
  document.body.classList.toggle("private", shouldHideAmounts);
  elementById("privacy-toggle").checked = shouldHideAmounts;
  try { sessionStorage.setItem("private", shouldHideAmounts ? "1" : "0"); } catch {}
  window.dispatchEvent(new CustomEvent("netto:privacy")); // the phone bar's eye button follows (app/phoneMenu.js)
  if (!redrawPages) return;
  if (shouldHideAmounts) starAmountsOnScreen();
  await loadAllData();
}

// Should amounts be hidden when the page loads?
export function shouldStartInPrivacyMode() {
  if (privacyOnLoadSetting !== "open") return true;
  let savedState = null;
  try { savedState = sessionStorage.getItem("private"); } catch {}
  return savedState !== "0"; // nothing saved = a freshly opened app: hidden
}

// Amounts shown and nothing done for long enough: hide them
function hideAmountsIfIdleTooLong() {
  if (!autoHideMinutes || isPrivacyModeOn()) return;
  if (Date.now() - lastActivityTime >= autoHideMinutes * 60000) setPrivacyMode(true);
}

function initializeAutoHide() {
  const noteActivity = () => { lastActivityTime = Date.now(); };
  for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
    window.addEventListener(eventName, noteActivity, { passive: true, capture: true });
  }
  setInterval(hideAmountsIfIdleTooLong, AUTO_HIDE_CHECK_EVERY_MILLISECONDS);
  // back to the front after a while (phone app switcher, another Mac window): check before anything else.
  // pageshow: Safari may restore a page from its memory without a visibility change
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") hideAmountsIfIdleTooLong(); });
  window.addEventListener("pageshow", hideAmountsIfIdleTooLong);

  const chips = elementById("privacy-auto-hide-chips");
  chips.addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    autoHideMinutes = Number(chip.dataset.value);
    try { localStorage.setItem(AUTO_HIDE_STORAGE_KEY, String(autoHideMinutes)); } catch {}
    noteActivity();
    highlightSelectedChip(chips, String(autoHideMinutes));
  });
  highlightSelectedChip(chips, String(autoHideMinutes));
}

export function initializePrivacyMode() {
  initializeAutoHide();
  elementById("privacy-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    privacyOnLoadSetting = chip.dataset.value;
    localStorage.setItem("privacyOnLoad", privacyOnLoadSetting);
    highlightSelectedChip(elementById("privacy-chips"), privacyOnLoadSetting);
  });
  highlightSelectedChip(elementById("privacy-chips"), privacyOnLoadSetting);
  elementById("privacy-toggle").addEventListener("change", (event) => setPrivacyMode(event.target.checked));
  window.addEventListener("netto:privacy", () => { lastActivityTime = Date.now(); }); // shown again: the 10 minutes start now
}
