// ---- the small bar at the bottom of the screen: "Coffee −0,60 € added · Undo · Change", "Deleted · Undo" ----
// One at a time: a new one replaces the one showing. It goes away by itself after a few seconds, or when one of
// its buttons is pressed. (Element: #quick-add-toast in Home.html, styles in 32-quick-add.css.)

import { elementById, createElement } from "./domHelpers.js";

const TOAST_MILLISECONDS = 6000;
let toastTimer = null;

export const hideToast = () => { elementById("quick-add-toast").hidden = true; };

// actions: [{ label, onClick }]; milliseconds: how long it stays (longer for a question that matters)
export function showToast(text, actions = [], milliseconds = TOAST_MILLISECONDS) {
  const toast = elementById("quick-add-toast");
  toast.replaceChildren(createElement("span", "", text), ...actions.map(({ label, onClick }) => {
    const button = createElement("button", "ghost", label);
    button.type = "button";
    button.addEventListener("click", () => { hideToast(); onClick(); });
    return button;
  }));
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, milliseconds);
}
