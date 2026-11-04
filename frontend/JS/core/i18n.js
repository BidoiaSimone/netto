// ---- netto's languages: English (as written in the code) and Italian ----
// The language is chosen in Settings > Language and kept per device (localStorage "language"), like the theme:
// the Mac can stay in English while a phone is in Italian. Changing it reloads the page, so everything is drawn
// again in the new language.
//
// English is the key: the code and Home.html are written in English, and core/italian.js says what each English text
// is in Italian. So:
//   - Home.html is translated once at startup by translatePage(): its texts and its placeholder / title / aria-label
//     attributes are looked up as they are (spaces collapsed). An element with translate="no" is left as it is;
//     one with data-i18n="…" is looked up by that key instead of its text, for the few English words that need
//     two Italian ones (the "Income" type is "Entrata", the "Income" column "Entrate").
//   - the JS writes t("Saved") or t("{count} days ago", { count }) wherever it shows a text; tp() picks
//     singular or plural first.
//   - what the server answers (an error, a label like "Investment results") goes through t() or
//     translateServerMessage() when it's shown: the server always speaks English.
// A text missing from core/italian.js just stays in English (tests/translations.test.js lists the missing ones).
// Amounts are written Italian style (1.234,56 €) in both languages, as before; dates follow the language.

import { ITALIAN, ITALIAN_PATTERNS } from "./italian.js";

export const LANGUAGES = ["en", "it"];
const STORAGE_KEY = "language";

export function getSavedLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.includes(saved) ? saved : "en";
  } catch {
    return "en";
  }
}

export function saveLanguage(language) {
  try { localStorage.setItem(STORAGE_KEY, language); } catch {}
}

export const language = getSavedLanguage();
export const isItalian = language === "it";
// for dates and month names (amounts always use "it-IT", see core/formatting.js)
export const dateLocale = isItalian ? "it-IT" : "en-GB";

const fillIn = (text, values) =>
  values ? text.replace(/\{(\w+)\}/g, (placeholder, name) => (name in values ? String(values[name]) : placeholder)) : text;

// t("Saved") -> "Risparmiato"; t("{count} days ago", { count: 3 }) -> "3 giorni fa". Unknown texts stay as they are.
export function t(english, values) {
  const text = isItalian && typeof english === "string" && Object.hasOwn(ITALIAN, english) ? ITALIAN[english] : english;
  return typeof text === "string" ? fillIn(text, values) : text;
}

// tp(3, "{count} day", "{count} days") -> "3 days" / "3 giorni"
export const tp = (count, singular, plural, values) => t(count === 1 ? singular : plural, { count, ...values });

// The server's error messages: the exact ones first, then the ones with a name or a number inside
export function translateServerMessage(message) {
  if (!isItalian || typeof message !== "string") return message;
  if (Object.hasOwn(ITALIAN, message)) return ITALIAN[message];
  for (const [pattern, italian] of ITALIAN_PATTERNS) {
    if (pattern.test(message)) return message.replace(pattern, italian);
  }
  return message;
}

// ---------- Home.html ----------

const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label", "label", "alt"];
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "svg", "KBD"]);

// A text as written in the HTML (with its line breaks and indentation) -> its Italian, keeping the spaces around it
function translateText(text) {
  const key = text.replace(/\s+/g, " ").trim();
  if (!key || !Object.hasOwn(ITALIAN, key)) return null;
  const [, before, after] = text.match(/^(\s*)[\s\S]*?(\s*)$/);
  return before + ITALIAN[key] + after;
}

function translateElementAttributes(element) {
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value === null) continue;
    const translated = translateText(value);
    if (translated !== null) element.setAttribute(attribute, translated.trim());
  }
}

export function translatePage(root = document.body) {
  document.documentElement.lang = language;
  if (!isItalian) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (SKIPPED_TAGS.has(element.tagName) || element.closest("[translate='no'], svg")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      translateElementAttributes(node);
      const key = node.dataset?.i18n;
      if (key && Object.hasOwn(ITALIAN, key)) node.textContent = ITALIAN[key];
    } else if (!node.parentElement.dataset.i18n) {
      const translated = translateText(node.nodeValue);
      if (translated !== null) node.nodeValue = translated;
    }
  }
}

// A category's name from the server, where transactions without a category come back as "Uncategorized"
export const nameOfCategory = (row) => (row.category_id == null && row.name === "Uncategorized" ? t("Uncategorized") : row.name);
