// ---- Settings > Theme (dark, light, or system = follow macOS) and Settings > Color (the accent) ----
// The first paint is handled by themeBeforeFirstPaint.js in Home.html's <head>; this keeps it in sync.

import { elementById, highlightSelectedChip } from "../core/domHelpers.js";

const systemPrefersLightTheme = matchMedia("(prefers-color-scheme: light)");
let themeSetting = localStorage.getItem("theme") || "dark";
let accentColorSetting = localStorage.getItem("accent") || "green";

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

export function initializeThemeAndAccentColor() {
  elementById("theme-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    themeSetting = chip.dataset.value;
    localStorage.setItem("theme", themeSetting);
    applyTheme();
  });
  systemPrefersLightTheme.addEventListener("change", () => { if (themeSetting === "system") applyTheme(); }); // macOS switched

  elementById("accent-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    accentColorSetting = chip.dataset.value;
    localStorage.setItem("accent", accentColorSetting);
    applyAccentColor();
  });

  applyTheme();
  applyAccentColor();
}
