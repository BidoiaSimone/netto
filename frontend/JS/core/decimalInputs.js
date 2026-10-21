// ---- decimal fields on phones: "12,50" typed with the Italian keyboard ----
// A number field (<input type="number">) on an iPhone set to Italian shows a keyboard with "," as the decimal key, and
// then refuses "12,50" (the field reads as empty): no decimals at all. On phones and tablets every decimal number field
// becomes a text field with the decimal keyboard, and a "," is turned into "." as it's typed, so the rest of the app
// still reads "12.50" from it. Fields added later (the goal's baselines, the budgets…) are converted as they appear.
// Computers keep the number field (arrows, and their keyboard has a "." anyway). Whole-number fields (days, steps of
// 1, 5, 10 with the numeric keypad) are left as they are.

const isTouchScreen = () => window.matchMedia?.("(pointer: coarse)").matches;

function isDecimalNumberField(element) {
  if (!(element instanceof HTMLInputElement) || element.type !== "number") return false;
  const step = element.getAttribute("step") ?? "";
  return element.inputMode === "decimal" || step === "any" || (step !== "" && !Number.isInteger(Number(step)));
}

// Call before reading input.type for anything else (core/domHelpers.js hides amounts by switching the type)
export function makeDecimalFieldCommaFriendly(element) {
  if (!isTouchScreen() || !isDecimalNumberField(element)) return;
  element.type = "text";
  element.inputMode = "decimal";
  element.autocomplete = "off";
  element.dataset.decimal = "";
}

function convertAllIn(root) {
  if (root instanceof HTMLInputElement) makeDecimalFieldCommaFriendly(root);
  root.querySelectorAll?.("input[type=number]").forEach(makeDecimalFieldCommaFriendly);
}

export function initializeDecimalInputs() {
  if (!isTouchScreen()) return;
  convertAllIn(document);
  new MutationObserver((changes) => changes.forEach((change) => change.addedNodes.forEach(convertAllIn)))
    .observe(document.body, { childList: true, subtree: true });
  // "12,5" -> "12.5" as it's typed, the cursor staying where it was
  document.addEventListener("input", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !("decimal" in field.dataset) || !field.value.includes(",")) return;
    const cursor = field.selectionStart;
    field.value = field.value.replace(/,/g, ".");
    field.setSelectionRange?.(cursor, cursor);
  }, true);
}
