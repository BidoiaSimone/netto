// Applies the saved theme and accent colour before anything is drawn, so a light theme never flashes
// dark first. Loaded as a normal (blocking) script in Home.html's <head>, before the stylesheets.
// Theme: "dark" (default) / "light" / "system" (follows macOS). Both are changed in Settings,
// see settings/themeAndAccentColor.js.
(function applySavedThemeAndAccentColor() {
  var theme = "dark";
  try { theme = localStorage.getItem("theme") || "dark"; } catch (error) {}
  if (theme === "system") theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = theme;

  var accentColor = "green";
  try { accentColor = localStorage.getItem("accent") || "green"; } catch (error) {}
  document.documentElement.dataset.accent = accentColor;
})();
