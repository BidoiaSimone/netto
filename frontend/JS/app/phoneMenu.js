// ---- phones: the sidebar as a menu that slides in, and the bar at the top ----
// On a narrow screen (31-phone.css) the sidebar is hidden off the left edge. The ☰ button slides it in; picking a
// page, tapping outside it, swiping it to the left or Escape closes it again. The bar at the top shows the
// page's name and an eye button for Hide amounts (the same switch as the one in the sidebar). Pocket's Settings
// button there opens Settings, and tapping it again closes it.
// Tapping the page's name reloads the app: the newest version of netto and fresh data, like ⌘R on the Mac. So does
// pulling the page down from its top and letting go (pull to refresh, like iOS apps), which also works when Pocket
// keeps the name hidden under the large title.
// No zooming, like an app: Safari on the iPhone ignores the viewport's user-scalable=no, so the pinch is stopped here.

import { elementById } from "../core/domHelpers.js";
import { setPrivacyMode, isPrivacyModeOn } from "../settings/privacyMode.js";
import { isPhoneScreen } from "../core/phoneFeatures.js";

const SWIPE_TO_CLOSE_PIXELS = 60;
const PULL_TO_RELOAD_PIXELS = 80;   // how far to pull down from the top of the page before letting go reloads

const isMenuOpen = () => document.body.classList.contains("phone-menu-open");

function setMenuOpen(open) {
  document.body.classList.toggle("phone-menu-open", open);
  elementById("phone-menu-backdrop").hidden = !open;
  elementById("phone-menu-button").setAttribute("aria-expanded", String(open));
}

// The page's name in the bar: the text of the active sidebar link. Pocket's Settings button in the bar lights up
// on the Settings page (it replaces the Settings tab)
function showPageTitle() {
  const activeLink = document.querySelector("#sidebar a.active");
  elementById("phone-page-title").textContent = activeLink?.textContent ?? "netto";
  elementById("phone-settings-button").classList.toggle("active", activeLink?.hash === "#settings");
}

// Pocket on the phone (37-ui-pocket.css), like iOS apps: each page opens with a large title, and the small name in
// the top bar only appears once that title has scrolled up under the bar (<body class="title-in-bar">)
function updateTitleInBar() {
  const largeTitle = document.querySelector("section[data-page]:not([hidden]) .page-head h2");
  const barBottom = elementById("phone-bar").getBoundingClientRect().bottom;
  const titleIsUnderTheBar = !largeTitle || largeTitle.getBoundingClientRect().bottom <= barBottom;
  document.body.classList.toggle("title-in-bar", titleIsUnderTheBar);
}

// Pocket's Settings button works as a toggle: the first tap opens Settings, a second tap closes it and goes back to
// the page it was opened from (with history.back(), so the browser history stays the same as before). If Settings
// wasn't opened from another page of the app (a reload on #settings, a bookmark), the second tap goes to Home.
let cameToSettingsFromAnotherPage = false;

function rememberWhereSettingsWasOpenedFrom(event) {
  const cameFrom = new URL(event.oldURL).hash;
  cameToSettingsFromAnotherPage = location.hash === "#settings" && cameFrom !== "#settings";
}

function toggleSettings(event) {
  if (location.hash !== "#settings") return;          // not on Settings: the link opens it as usual
  event.preventDefault();
  if (cameToSettingsFromAnotherPage) history.back();
  else location.hash = "#home";
}

function showPrivacyState() {
  const hidden = isPrivacyModeOn();
  const button = elementById("phone-privacy-button");
  button.classList.toggle("active", hidden);
  button.setAttribute("aria-label", hidden ? "Show amounts" : "Hide amounts");
}

// Pull to refresh: on a phone, at the very top of a page (no dialog open), a finger pulled down far enough and then
// lifted reloads. A small arrow follows the finger and turns when letting go will reload (31-phone.css).
function initializePullToReload() {
  const indicator = document.createElement("div");
  indicator.id = "pull-to-reload";
  indicator.setAttribute("aria-hidden", "true");
  indicator.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.append(indicator);

  let startY = null;
  let pulled = 0;
  const reset = () => { startY = null; pulled = 0; indicator.className = ""; indicator.style.removeProperty("--pull"); };

  window.addEventListener("touchstart", (event) => {
    const canStart = isPhoneScreen() && window.scrollY <= 0 && event.touches.length === 1 && !document.querySelector("dialog[open]")
      && !isMenuOpen();
    startY = canStart ? event.touches[0].clientY : null;
  }, { passive: true });
  window.addEventListener("touchmove", (event) => {
    if (startY === null) return;
    if (window.scrollY > 0) { reset(); return; }        // the page scrolled instead: not a pull
    pulled = Math.max(0, event.touches[0].clientY - startY);
    indicator.style.setProperty("--pull", String(Math.min(pulled, PULL_TO_RELOAD_PIXELS * 1.5)));
    indicator.classList.toggle("visible", pulled > 10);
    indicator.classList.toggle("ready", pulled >= PULL_TO_RELOAD_PIXELS);
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (startY !== null && pulled >= PULL_TO_RELOAD_PIXELS) {
      indicator.className = "visible ready reloading";
      location.reload();
      return;
    }
    reset();
  });
  window.addEventListener("touchcancel", reset);
}

// Safari's pinch, two ways, since neither stops it on every iOS version: cancel Apple's own "gesturestart" and
// "gesturechange" events, and cancel any move made with two fingers (passive: false, or Safari ignores the cancel)
function preventPinchZoom() {
  for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (event) => event.preventDefault());
  document.addEventListener("touchmove", (event) => { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });
}

export function initializePhoneMenu() {
  preventPinchZoom();
  initializePullToReload();
  elementById("phone-menu-button").addEventListener("click", () => setMenuOpen(!isMenuOpen()));
  elementById("phone-menu-backdrop").addEventListener("click", () => setMenuOpen(false));
  elementById("sidebar").addEventListener("click", (event) => { if (event.target.closest("a")) setMenuOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && isMenuOpen()) setMenuOpen(false); });

  // a swipe to the left on the open menu closes it
  let swipeStartX = null;
  const sidebar = elementById("sidebar");
  sidebar.addEventListener("touchstart", (event) => { swipeStartX = event.touches[0].clientX; }, { passive: true });
  sidebar.addEventListener("touchend", (event) => {
    if (swipeStartX !== null && swipeStartX - event.changedTouches[0].clientX > SWIPE_TO_CLOSE_PIXELS) setMenuOpen(false);
    swipeStartX = null;
  }, { passive: true });

  window.addEventListener("hashchange", rememberWhereSettingsWasOpenedFrom);
  elementById("phone-settings-button").addEventListener("click", toggleSettings);
  window.addEventListener("hashchange", () => { showPageTitle(); setMenuOpen(false); window.scrollTo(0, 0); updateTitleInBar(); });
  window.addEventListener("scroll", updateTitleInBar, { passive: true });
  window.addEventListener("resize", updateTitleInBar);
  requestAnimationFrame(updateTitleInBar);
  elementById("phone-page-title").addEventListener("click", (event) => {
    event.currentTarget.classList.add("reloading");
    location.reload();
  });
  showPageTitle();

  elementById("phone-privacy-button").addEventListener("click", async () => {
    const promise = setPrivacyMode(!isPrivacyModeOn());
    showPrivacyState();
    await promise;
  });
  elementById("privacy-toggle").addEventListener("change", showPrivacyState);
  window.addEventListener("netto:privacy", showPrivacyState);
  showPrivacyState();
}
