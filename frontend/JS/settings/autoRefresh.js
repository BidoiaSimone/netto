// ---- Settings > Auto Refresh: reloads the data (not the page) every few seconds ----

import { elementById } from "../core/domHelpers.js";
import { loadAllData } from "../core/dataRefresh.js";

const AUTO_REFRESH_INTERVAL_MILLISECONDS = 10000;

let autoRefreshTimer = null; // null = off

function setAutoRefresh(isOn) {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = isOn ? setInterval(loadAllData, AUTO_REFRESH_INTERVAL_MILLISECONDS) : null;
  elementById("refreshToggle").textContent = `Auto Refresh: ${isOn ? "ON" : "OFF"}`;
  localStorage.setItem("autoRefresh", isOn ? "on" : "off");
}

export function initializeAutoRefreshButton() {
  elementById("refreshToggle").addEventListener("click", () => setAutoRefresh(autoRefreshTimer === null));
}

// The setting chosen last time
export function restoreSavedAutoRefresh() {
  setAutoRefresh(localStorage.getItem("autoRefresh") === "on");
}
