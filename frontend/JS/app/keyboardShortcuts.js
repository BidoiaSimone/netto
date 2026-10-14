// ---- keyboard shortcuts: N = new transaction, P = hide / show amounts ----

import { openDialog } from "./dialogWindows.js";
import { setPrivacyMode, isPrivacyModeOn } from "../settings/privacyMode.js";

// Shortcuts are ignored while typing in a field, with a modifier key held, or with a dialog open
function shouldIgnoreShortcut(event) {
  return event.ctrlKey || event.metaKey || event.altKey
    || event.target.matches?.("input, select, textarea")
    || Boolean(document.querySelector("dialog[open]"));
}

export function initializeKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (shouldIgnoreShortcut(event)) return;
    if (event.key === "n") { event.preventDefault(); openDialog("tx-dialog"); }
    if (event.key === "p") { event.preventDefault(); setPrivacyMode(!isPrivacyModeOn()); }
  });
}
