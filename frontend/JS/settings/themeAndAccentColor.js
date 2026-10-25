// ---- Settings > Theme (dark, light, or system = follow macOS), Settings > Color (the accent)
//      Settings > Layout (classic or pocket: the same pages, arranged and drawn differently)
//      and, on a phone, Settings > On this phone (the essentials or everything: core/phoneFeatures.js) ----
// The first paint is handled by themeBeforeFirstPaint.js in Home.html's <head>; this keeps it in sync.

import { elementById, highlightSelectedChip } from "../core/domHelpers.js";
import { setPhoneFeatures } from "../core/phoneFeatures.js";
import { readStored, writeStored } from "../core/deviceStorage.js";

const systemPrefersLightTheme = matchMedia("(prefers-color-scheme: light)");
let themeSetting = readStored("theme") || "dark";
let accentColorSetting = readStored("accent") || "green";
const LAYOUTS = ["classic", "pocket"]; // Pocket: 37-ui-pocket.css (classic is the base)
let layoutSetting = document.documentElement.dataset.ui; // already checked by themeBeforeFirstPaint.js

// The installed app's title bar follows the page background, whatever theme and colour
function updateWindowTitleBarColor() {
  const pageBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]').content = pageBackgroundColor;
}

function applyTheme() {
  const theme = themeSetting === "system" ? (systemPrefersLightTheme.matches ? "light" : "dark") : themeSetting;
  document.documentElement.dataset.theme = theme;
  updateWindowTitleBarColor();
  highlightSelectedChip(elementById("theme-chips"), themeSetting);
}

function applyAccentColor() {
  document.documentElement.dataset.accent = accentColorSetting;
  highlightSelectedChip(elementById("accent-chips"), accentColorSetting);
  updateWindowTitleBarColor();
}

// The layout only changes CSS: <html data-ui="..."> picks which stylesheet rules apply; nothing is rebuilt.
function applyLayout() {
  document.documentElement.dataset.ui = layoutSetting;
  highlightSelectedChip(elementById("layout-chips"), layoutSetting);
  updateWindowTitleBarColor();
}

export function initializeThemeAndAccentColor() {
  elementById("theme-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    themeSetting = chip.dataset.value;
    writeStored("theme", themeSetting);
    applyTheme();
  });
  systemPrefersLightTheme.addEventListener("change", () => { if (themeSetting === "system") applyTheme(); }); // macOS switched

  elementById("accent-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    accentColorSetting = chip.dataset.value;
    writeStored("accent", accentColorSetting);
    applyAccentColor();
  });

  elementById("layout-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip || !LAYOUTS.includes(chip.dataset.value)) return;
    layoutSetting = chip.dataset.value;
    writeStored("ui", layoutSetting);
    applyLayout();
    window.dispatchEvent(new Event("resize")); // charts sized to their box draw again at the new size
  });

  elementById("phone-features-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    setPhoneFeatures(chip.dataset.value);
    highlightSelectedChip(elementById("phone-features-chips"), chip.dataset.value);
  });
  highlightSelectedChip(elementById("phone-features-chips"), document.documentElement.dataset.phoneFeatures);

  applyTheme();
  applyAccentColor();
  applyLayout();
}
