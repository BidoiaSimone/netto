// Applies the saved theme, accent colour and layout before anything is drawn, so a light theme never flashes
// dark first. Loaded as a normal (blocking) script in Home.html's <head>, before the stylesheets.
// Theme: "dark" (default) / "light" / "system" (follows macOS). All three (theme, colour and layout) are changed
// in Settings, see settings/themeAndAccentColor.js.
// Layout: "classic" (default, the sidebar) or "pocket": <html data-ui>, Pocket styled by 37-ui-pocket.css. Kept per device, like the theme: the Mac and the phone can each have their own.
// Phone features: "core" (default) or "all": <html data-phone-features>, see core/phoneFeatures.js.
// Language: "en" or "it": <html lang data-language>. Nothing chosen in Settings: the device's own language (Italian if
// it's Italian, else English), the same rule as core/i18n.js. In Italian the page stays invisible
// (data-translating, 01-theme-colors.css) until main.js has translated it, so the English never flashes first.
(function applySavedThemeAccentColorAndLayout() {
  var theme = "dark";
  try { theme = localStorage.getItem("theme") || "dark"; } catch (error) {}
  if (theme === "system") theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = theme;

  var accentColor = "green";
  try { accentColor = localStorage.getItem("accent") || "green"; } catch (error) {}
  document.documentElement.dataset.accent = accentColor;

  var layout = "classic";
  try { layout = localStorage.getItem("ui") || "classic"; } catch (error) {}
  if (["panel", "grid", "grid-ares", "pocket-dash"].indexOf(layout) !== -1) layout = "pocket"; // layouts tried and removed (Oct 2026)
  if (["classic", "pocket"].indexOf(layout) === -1) layout = "classic";
  document.documentElement.dataset.ui = layout;

  var phoneFeatures = "core";
  try { phoneFeatures = localStorage.getItem("phoneFeatures") === "all" ? "all" : "core"; } catch (error) {}
  document.documentElement.dataset.phoneFeatures = phoneFeatures;

  var language = null;
  try { language = localStorage.getItem("language"); } catch (error) {}
  if (language !== "en" && language !== "it") {
    var preferred = "";
    try { preferred = (navigator.languages && navigator.languages[0]) || navigator.language || ""; } catch (error) {}
    language = preferred.toLowerCase().indexOf("it") === 0 ? "it" : "en";
  }
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
  if (language !== "en") document.documentElement.dataset.translating = "";
})();
