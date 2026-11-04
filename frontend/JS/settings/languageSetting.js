// ---- Settings > Language: English or Italiano, on this device ----
// Kept in localStorage like the theme (core/i18n.js reads it, themeBeforeFirstPaint.js too, before anything is
// drawn). Every text on the page is written once in the chosen language, so a change reloads the page.

import { elementById, highlightSelectedChip } from "../core/domHelpers.js";
import { language, saveLanguage } from "../core/i18n.js";

export function initializeLanguageSetting() {
  const chips = elementById("language-chips");
  highlightSelectedChip(chips, language);
  chips.addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip || chip.dataset.value === language) return;
    saveLanguage(chip.dataset.value);
    highlightSelectedChip(chips, chip.dataset.value);
    location.reload();
  });
}
