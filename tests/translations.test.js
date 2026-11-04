/* TRANSLATIONS (frontend/JS/core/i18n.js and frontend/JS/core/italian.js)
 * netto is written in English, and Settings > Language can switch a device to Italian. English is the key: Home.html's
 * texts and the code's t("…") / tp("…") are looked up in core/italian.js. These tests make sure nothing is left
 * without its Italian (a new text shows up here as a failure that names it), that each translation keeps the {values}
 * of its English, and that translating works: plurals, values filled in, the server's messages.
 * No database and no browser: the files are read as text.
 */

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND = path.join(__dirname, "../frontend");
const read = (relativePath) => fs.readFileSync(path.join(FRONTEND, relativePath), "utf8");

// Texts that are the same in both languages and needn't be listed (the app's name, a number, a unit)
const SAME_IN_EVERY_LANGUAGE = new Set(["netto", "light"]);

let ITALIAN, ITALIAN_PATTERNS, i18n;

// The two files are ES modules (the project's package.json says "commonjs"), so they're loaded from their source.
// i18n.js imports italian.js: its source goes in its place. localStorage says "it", as on a phone set to Italian.
before(async () => {
  const italianSource = read("JS/core/italian.js");
  ({ ITALIAN, ITALIAN_PATTERNS } = await import("data:text/javascript," + encodeURIComponent(italianSource)));
  const i18nSource = read("JS/core/i18n.js")
    .replace(/^import \{ ITALIAN, ITALIAN_PATTERNS \} from "\.\/italian\.js";$/m, () => italianSource.replace(/^export /gm, "")); // a function: the source has "$&" in it
  globalThis.localStorage = { getItem: (key) => (key === "language" ? "it" : null), setItem() {} };
  i18n = await import("data:text/javascript," + encodeURIComponent(i18nSource));
});

// ---------- every text has its Italian ----------

const listJavaScriptFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const entryPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
  return entry.name.endsWith(".js") && entry.name !== "italian.js" ? [entryPath] : [];
});

// "a" or "a" + "b" (a long text split over lines), as written in the code -> its text
const STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const JOINED_STRINGS = String.raw`${STRING}(?:\s*\+\s*${STRING})*`;
const joinStrings = (source) => source.match(new RegExp(STRING, "g")).map((literal) => JSON.parse(literal)).join("");

// The keys the code asks for: t("…"), tp(count, "…", "…") and formatCount(count, "word") ("{count} word(s)")
function findKeysInCode(source) {
  const keys = [];
  for (const match of source.matchAll(new RegExp(String.raw`(?<![\w.])t\(\s*(${JOINED_STRINGS})`, "g"))) keys.push(joinStrings(match[1]));
  for (const match of source.matchAll(new RegExp(String.raw`(?<![\w.])tp\([^,]+,\s*(${STRING}),\s*(${STRING})`, "g"))) {
    keys.push(JSON.parse(match[1]), JSON.parse(match[2]));
  }
  for (const match of source.matchAll(new RegExp(String.raw`formatCount\([^,]+,\s*(${STRING})`, "g"))) {
    const word = JSON.parse(match[1]);
    keys.push(`{count} ${word}`, `{count} ${word}s`);
  }
  return keys;
}

// What translatePage() looks up in Home.html: the texts (spaces collapsed) and the placeholder / title /
// aria-label / label / alt attributes inside <body>, but not in <script>, <style>, <svg>, <kbd> or translate="no";
// an element with data-i18n is looked up by that key instead of its text
function findKeysInPage(html) {
  const body = html.slice(html.indexOf("<body"));
  const keys = [];
  const open = []; // [tagName, skipsTranslation, hasOwnKey]
  const collapse = (text) => text.replace(/\s+/g, " ").trim();
  const decode = (text) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
  const isSkipping = () => open.some(([, skips, hasOwnKey]) => skips || hasOwnKey);
  const VOID_TAGS = new Set(["input", "img", "br", "hr", "meta", "link", "source", "wbr"]);
  for (const [token] of body.matchAll(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) {
      const tagName = token.slice(2, -1).trim().toLowerCase();
      const index = open.map(([name]) => name).lastIndexOf(tagName);
      if (index >= 0) open.length = index;
      continue;
    }
    if (token.startsWith("<")) {
      const tagName = token.match(/^<([\w-]+)/)[1].toLowerCase();
      const attributes = Object.fromEntries([...token.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]));
      const skips = ["script", "style", "svg", "kbd"].includes(tagName) || attributes.translate === "no";
      if (!isSkipping() && !skips) {
        for (const name of ["placeholder", "title", "aria-label", "label", "alt"]) if (attributes[name]) keys.push(collapse(attributes[name]));
        if (attributes["data-i18n"]) keys.push(attributes["data-i18n"]);
      }
      if (!VOID_TAGS.has(tagName) && !token.endsWith("/>")) open.push([tagName, skips, Boolean(attributes["data-i18n"])]);
      continue;
    }
    if (!isSkipping()) keys.push(collapse(decode(token)));
  }
  return keys.filter((key) => /[A-Za-z]/.test(key) && !SAME_IN_EVERY_LANGUAGE.has(key));
}

const listMissing = (keys) => [...new Set(keys)].filter((key) => !Object.hasOwn(ITALIAN, key));

test("every text of Home.html has its Italian", () => {
  const keys = findKeysInPage(read("HTML/Home.html"));
  assert.ok(keys.length > 300, `only ${keys.length} texts found: is the page read right?`);
  assert.deepEqual(listMissing(keys), [], "add these to frontend/JS/core/italian.js");
});

test("every t(), tp() and formatCount() of the code has its Italian", () => {
  const keys = listJavaScriptFiles(path.join(FRONTEND, "JS")).flatMap((file) => findKeysInCode(fs.readFileSync(file, "utf8")));
  assert.ok(keys.length > 500, `only ${keys.length} texts found: is the code read right?`);
  assert.deepEqual(listMissing(keys), [], "add these to frontend/JS/core/italian.js");
});

test("each translation keeps the {values} of its English", () => {
  const valuesOf = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
  const different = Object.entries(ITALIAN).filter(([english, italian]) => valuesOf(english).join() !== valuesOf(italian).join());
  assert.deepEqual(different, []);
});

// ---------- translating ----------

test("t() translates and fills in the values; an unknown text stays as it is", () => {
  assert.equal(i18n.isItalian, true);
  assert.equal(i18n.dateLocale, "it-IT");
  assert.equal(i18n.t("Saved"), "Risparmiato");
  assert.equal(i18n.t("Edit {name}", { name: "Contanti" }), "Modifica Contanti");
  assert.equal(i18n.t("Not a text netto has"), "Not a text netto has");
  assert.equal(i18n.t("{amount} left", {}), "{amount} rimasti"); // a value not given stays visible, not "undefined"
});

test("tp() picks the singular for 1 and the plural otherwise", () => {
  assert.equal(i18n.tp(1, "{count} day", "{count} days"), "1 giorno");
  assert.equal(i18n.tp(3, "{count} day", "{count} days"), "3 giorni");
  assert.equal(i18n.tp(0, "{count} day", "{count} days"), "0 giorni");
});

test("the server's messages: the exact ones, and the ones with a name inside", () => {
  assert.equal(i18n.translateServerMessage("date can't be in the future"), "la data non può essere nel futuro");
  assert.equal(i18n.translateServerMessage("Cash is closed: reopen it on the Assets page to use it again"),
    "Cash è chiuso: riaprilo nella pagina Conti per usarlo di nuovo");
  assert.equal(i18n.translateServerMessage("Groceries already exists among the expense categories"), "Groceries esiste già tra le categorie di uscita");
  assert.equal(i18n.translateServerMessage("Other expenses (4 categories)"), "Altre uscite (4 categorie)");
  assert.equal(i18n.translateServerMessage("Average of the last 4 complete months (July – October)."), "Media degli ultimi 4 mesi completi (luglio – ottobre).");
  assert.equal(i18n.translateServerMessage("Average of the last complete month (October). Expenses = your budgets + what categories without a budget usually cost."),
    "Media dell'ultimo mese completo (ottobre). Uscite = i tuoi budget + quanto costano di solito le categorie senza budget.");
  assert.equal(i18n.translateServerMessage("something new the server says"), "something new the server says");
});

test("every pattern of the server's messages is a whole message, and its Italian uses only its own parts", () => {
  for (const [pattern, italian] of ITALIAN_PATTERNS) {
    assert.ok(pattern.source.startsWith("^") && pattern.source.endsWith("$"), `${pattern} must match a whole message`);
    if (typeof italian === "function") continue; // it writes the Italian from the parts itself
    const parts = new RegExp(`${pattern.source}|`).exec("").length - 1;
    for (const [, number] of italian.matchAll(/\$(\d)/g)) assert.ok(Number(number) <= parts, `${pattern}: $${number} isn't one of its ${parts} parts`);
  }
});
