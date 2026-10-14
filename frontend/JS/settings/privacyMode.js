// ---- privacy mode: blurs every amount except the transactions (see body.private in the CSS) ----
// Settings > Hide amounts: "always" = hidden after every load (default),
// "open" = a reload keeps the current state, but opening the app again starts hidden.
// The current state lives in sessionStorage: it survives reloads and is wiped when the window closes.

import { elementById, highlightSelectedChip } from "../core/domHelpers.js";

let privacyOnLoadSetting = localStorage.getItem("privacyOnLoad") || "always";

export const isPrivacyModeOn = () => document.body.classList.contains("private");

export function setPrivacyMode(shouldHideAmounts) {
  document.body.classList.toggle("private", shouldHideAmounts);
  elementById("privacy-toggle").checked = shouldHideAmounts;
  try { sessionStorage.setItem("private", shouldHideAmounts ? "1" : "0"); } catch {}
}

// Should amounts be hidden when the page loads?
export function shouldStartInPrivacyMode() {
  if (privacyOnLoadSetting !== "open") return true;
  let savedState = null;
  try { savedState = sessionStorage.getItem("private"); } catch {}
  return savedState !== "0"; // nothing saved = a freshly opened app: hidden
}

export function initializePrivacyMode() {
  elementById("privacy-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    privacyOnLoadSetting = chip.dataset.value;
    localStorage.setItem("privacyOnLoad", privacyOnLoadSetting);
    highlightSelectedChip(elementById("privacy-chips"), privacyOnLoadSetting);
  });
  highlightSelectedChip(elementById("privacy-chips"), privacyOnLoadSetting);
  elementById("privacy-toggle").addEventListener("change", (event) => setPrivacyMode(event.target.checked));
}
