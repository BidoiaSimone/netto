// ---- Settings > Auto Refresh: reloads the data (not the page) every few seconds ----
// Also, always on: coming back to netto after more than a minute away (the app left open on the phone, another
// window on the Mac) reloads the data, so what you see includes what you added elsewhere meanwhile.

import { elementById } from "../core/domHelpers.js";
import { loadAllData } from "../core/dataRefresh.js";
import { askServiceWorkerToRetry } from "../core/connectionState.js";

const AUTO_REFRESH_INTERVAL_MILLISECONDS = 10000;
const REFRESH_WHEN_BACK_AFTER_MILLISECONDS = 60000;
let wentAwayAt = null;

let autoRefreshTimer = null; // null = off

function setAutoRefresh(isOn) {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = isOn ? setInterval(loadAllData, AUTO_REFRESH_INTERVAL_MILLISECONDS) : null;
  elementById("refreshToggle").textContent = `Auto Refresh: ${isOn ? "ON" : "OFF"}`;
  localStorage.setItem("autoRefresh", isOn ? "on" : "off");
}

function refreshWhenBackAfterAWhile() {
  if (document.visibilityState === "hidden") {
    wentAwayAt = Date.now();
  } else if (wentAwayAt !== null) {
    if (Date.now() - wentAwayAt > REFRESH_WHEN_BACK_AFTER_MILLISECONDS) { askServiceWorkerToRetry(); loadAllData(); }
    wentAwayAt = null;
  }
}

export function initializeAutoRefreshButton() {
  document.addEventListener("visibilitychange", refreshWhenBackAfterAWhile);
  elementById("refreshToggle").addEventListener("click", () => setAutoRefresh(autoRefreshTimer === null));
}

// The setting chosen last time
export function restoreSavedAutoRefresh() {
  setAutoRefresh(localStorage.getItem("autoRefresh") === "on");
}
