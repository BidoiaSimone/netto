// ---- the categories' icons and colours: a white line drawing on a solid colour circle ----
// Each category may pick an icon and a colour on the Categories page (stored as `icon` and `color`, migration 21).
// The lists lead each transaction with createCategoryIcon(); a category without an icon shows its initial, and one
// without a colour gets one from the pie's palette, picked by its name (always the same one for the same name).
//
// The drawings: 24 × 24, lines only (stroke 1.8, round ends), so they all look like one set. Each has a default
// colour, used when the category hasn't picked one. The server only checks a name's shape, so a drawing removed
// from here later just shows as the initial again: never rename or remove one that may be in use, add new ones.

import { createElement } from "./domHelpers.js";
import { appState } from "./appState.js";
import { SLICE_COLORS } from "../pages/assetsPieChart.js";

// Solid colours white reads well on (at least about 3 : 1), in rainbow order: the picker shows them in this order
export const CATEGORY_COLORS = [
  { color: "#e0484e", label: "Red" },
  { color: "#e66767", label: "Coral" },
  { color: "#e46a2c", label: "Orange" },
  { color: "#b77900", label: "Amber" },
  { color: "#5f8c17", label: "Olive" },
  { color: "#2f9e44", label: "Green" },
  { color: "#0f9b8e", label: "Teal" },
  { color: "#1597b8", label: "Cyan" },
  { color: "#3478f6", label: "Blue" },
  { color: "#2d4f8a", label: "Navy" },
  { color: "#5b5bd6", label: "Indigo" },
  { color: "#8e5bd6", label: "Purple" },
  { color: "#d6408a", label: "Pink" },
  { color: "#9a6b4b", label: "Brown" },
  { color: "#5f6b73", label: "Graphite" },
  { color: "#3a4046", label: "Charcoal" },
];

const [RED, CORAL, ORANGE, AMBER, OLIVE, GREEN, TEAL, CYAN, BLUE, NAVY, INDIGO, PURPLE, PINK, BROWN, GRAPHITE, CHARCOAL] = CATEGORY_COLORS.map((entry) => entry.color);

// name -> { label, color (the default), drawing (the inside of a 24 × 24 <svg>) }, grouped the way the picker shows them
export const CATEGORY_ICONS = {
  // everyday spending
  "cart": { label: "Groceries", color: GREEN, drawing: `<path d="M3 4h2.2l2.1 10.1a1 1 0 0 0 1 .9h8.6a1 1 0 0 0 1-.8L19.6 8H6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>` },
  "fork-knife": { label: "Food", color: ORANGE, drawing: `<path d="M6.5 3v5.5a2.5 2.5 0 0 0 5 0V3M9 3v18M16.5 21V3c2.2 1.3 3 4 3 7.5V13h-3"/>` },
  "coffee": { label: "Coffee", color: BROWN, drawing: `<path d="M4.5 9.5h11v4a5.5 5.5 0 0 1-5.5 5.5a5.5 5.5 0 0 1-5.5-5.5zM15.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.5M8.5 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/>` },
  "drink": { label: "Drinks", color: CORAL, drawing: `<path d="M5 4.5h14l-7 8zM12 12.5V20M8 20h8M7.6 7.5h8.8"/>` },
  "box": { label: "Products", color: NAVY, drawing: `<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>` },
  "shirt": { label: "Clothes", color: INDIGO, drawing: `<path d="M9 4L4 6.5l1.8 4 2.2-1V20h8V9.5l2.2 1 1.8-4L15 4c-.4 1.4-1.6 2.3-3 2.3S9.4 5.4 9 4z"/>` },
  "pills": { label: "Medicine", color: PINK, drawing: `<g transform="rotate(-45 9 9.5)"><rect x="2.5" y="6.5" width="13" height="6" rx="3"/><path d="M9 6.5v6"/></g><circle cx="16.5" cy="16.5" r="4.5"/><path d="M13.3 19.7l6.4-6.4"/>` },
  "heart": { label: "Health", color: RED, drawing: `<path d="M12 20s-7.5-4.6-7.5-10a4.2 4.2 0 0 1 7.5-2.6a4.2 4.2 0 0 1 7.5 2.6c0 5.4-7.5 10-7.5 10z"/>` },
  "scissors": { label: "Haircut", color: PURPLE, drawing: `<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8.1 8.4L20 18M8.1 15.6L20 6"/>` },
  "wrench": { label: "Service", color: OLIVE, drawing: `<path d="M15.5 3.5a4.5 4.5 0 0 0-4.2 6.1l-6.8 6.8a2.1 2.1 0 0 0 3 3l6.8-6.8a4.5 4.5 0 0 0 6.1-4.2l-2.6 2.6-2.8-.5-.5-2.8z"/>` },
  // home and bills
  "home": { label: "Rent", color: TEAL, drawing: `<path d="M4 11l8-6.5 8 6.5M6 9.5V20h12V9.5M10 20v-5h4v5"/>` },
  "bolt": { label: "Electricity", color: AMBER, drawing: `<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>` },
  "flame": { label: "Gas", color: RED, drawing: `<path d="M12 21a6 6 0 0 0 6-6c0-3.6-2.6-5.6-3.6-9c-2 1.4-3.1 3.5-3 5.6c-1-.5-1.8-1.6-2-2.9C7.7 10.2 6 12.5 6 15a6 6 0 0 0 6 6z"/>` },
  "drop": { label: "Water", color: CYAN, drawing: `<path d="M12 3.5c3.2 4 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 2.8-6.5 6-10.5z"/>` },
  "wifi": { label: "Internet", color: BLUE, drawing: `<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 16a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19.2" r=".9"/>` },
  "phone": { label: "Phone", color: GRAPHITE, drawing: `<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>` },
  "receipt": { label: "Bills, taxes", color: CHARCOAL, drawing: `<path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21zM9 8h6M9 12h6M9 16h3.5"/>` },
  "shield": { label: "Insurance", color: NAVY, drawing: `<path d="M12 3l7 3v5.5c0 4.3-3 8-7 9.5c-4-1.5-7-5.2-7-9.5V6z"/>` },
  // getting around
  "bus": { label: "Transport", color: BLUE, drawing: `<path d="M6 4h12a2 2 0 0 1 2 2v11H4V6a2 2 0 0 1 2-2zM4 12h16M7 17v2.5M17 17v2.5"/><circle cx="8" cy="14.6" r=".9"/><circle cx="16" cy="14.6" r=".9"/>` },
  "train": { label: "Train", color: INDIGO, drawing: `<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 10.5h12M9 20.5l1.5-3.5M15 20.5l-1.5-3.5"/><circle cx="9" cy="13.8" r=".9"/><circle cx="15" cy="13.8" r=".9"/>` },
  "car": { label: "Car", color: GRAPHITE, drawing: `<path d="M4 17v-4.5l1.9-5A2 2 0 0 1 7.8 6h8.4a2 2 0 0 1 1.9 1.5l1.9 5V17zM4 12.5h16M6.5 17v2.2M17.5 17v2.2"/><circle cx="7.6" cy="14.8" r=".9"/><circle cx="16.4" cy="14.8" r=".9"/>` },
  "fuel": { label: "Fuel", color: AMBER, drawing: `<path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M3.5 20h12M5 10h9M14 8.5h2.5A1.5 1.5 0 0 1 18 10v6.5a1.5 1.5 0 0 0 3 0V9l-2.5-3"/>` },
  "bike": { label: "Bike", color: GREEN, drawing: `<circle cx="6" cy="16.5" r="3.5"/><circle cx="18" cy="16.5" r="3.5"/><path d="M6 16.5L10 9h5.5l2.5 7.5M10 9l3 7.5H6M14.5 6H17l-1.5 3"/>` },
  "plane": { label: "Trips", color: CYAN, drawing: `<path d="M21 15.5v-2L13.5 9V4.5a1.5 1.5 0 0 0-3 0V9L3 13.5v2l7.5-2.5v4.5L8 19.5V21l4-1 4 1v-1.5l-2.5-2V13z"/>` },
  // free time
  "ticket": { label: "Leisure", color: CORAL, drawing: `<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14.5 7v2M14.5 11v2M14.5 15v2"/>` },
  "music": { label: "Subscriptions", color: PINK, drawing: `<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>` },
  "tv": { label: "Streaming", color: CHARCOAL, drawing: `<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M10.5 8.5v5l4-2.5z"/>` },
  "gamepad": { label: "Games", color: INDIGO, drawing: `<path d="M7 8h10a4 4 0 0 1 4 4v1.5a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.1 1.3A3 3 0 0 1 3 13.5V12a4 4 0 0 1 4-4zM8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11.2" r=".9"/><circle cx="17.3" cy="12.9" r=".9"/>` },
  "dice": { label: "Board games", color: PURPLE, drawing: `<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="15.5" cy="15.5" r="1.1"/>` },
  "dumbbell": { label: "Sport", color: TEAL, drawing: `<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>` },
  "book": { label: "Books", color: BROWN, drawing: `<path d="M12 6.5C10 5 7 4.6 4 5v13c3-.4 6 .1 8 1.5c2-1.4 5-1.9 8-1.5V5c-3-.4-6 0-8 1.5zM12 6.5v13"/>` },
  "graduation": { label: "Study", color: NAVY, drawing: `<path d="M2.5 9.5L12 5l9.5 4.5L12 14zM6.5 11.5V16c1.5 1.5 3.5 2.3 5.5 2.3s4-.8 5.5-2.3v-4.5M21.5 9.5v5"/>` },
  "paw": { label: "Pets", color: BROWN, drawing: `<circle cx="6.5" cy="10.5" r="1.6"/><circle cx="9.8" cy="6.5" r="1.6"/><circle cx="14.2" cy="6.5" r="1.6"/><circle cx="17.5" cy="10.5" r="1.6"/><path d="M12 12c-2.5 0-5 3.5-5 5.5c0 1.5 1.3 2 2.5 2c1 0 1.6-.5 2.5-.5s1.5.5 2.5.5c1.2 0 2.5-.5 2.5-2c0-2-2.5-5.5-5-5.5z"/>` },
  "gift": { label: "Gift", color: PURPLE, drawing: `<path d="M4.5 11h15v9h-15zM3 7.5h18V11H3zM12 7.5V20M12 7.5C10.5 4 7 4 7.2 6c.2 1.4 2.8 1.5 4.8 1.5M12 7.5c1.5-3.5 5-3.5 4.8-1.5c-.2 1.4-2.8 1.5-4.8 1.5"/>` },
  // money coming in
  "briefcase": { label: "Salary", color: BLUE, drawing: `<path d="M4 8h16v11H4zM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M4 13h16"/>` },
  "kiosk": { label: "Shop job", color: ORANGE, drawing: `<path d="M4 9l1.5-5h13L20 9a2.7 2.7 0 0 1-5.3 0a2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 9zM5 11v9h14v-9M10 20v-5h4v5"/>` },
  "landmark": { label: "Pension, state", color: NAVY, drawing: `<path d="M3 20h18M4 10h16L12 4zM6 10v7M10 10v7M14 10v7M18 10v7M4.5 17h15"/>` },
  "percent": { label: "Interest", color: GREEN, drawing: `<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/>` },
  "refund": { label: "Refunds", color: TEAL, drawing: `<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>` },
  "voucher": { label: "Vouchers", color: AMBER, drawing: `<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.6 6.6a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>` },
  "coins": { label: "Other income", color: GRAPHITE, drawing: `<circle cx="10" cy="13" r="7"/><path d="M9.8 6A6 6 0 1 1 16.8 14.7M12.6 10.4A3.7 3.7 0 1 0 12.6 15.6M6.4 12.1h4.6M6.4 13.9h4.6"/>` },
  "star": { label: "Special", color: AMBER, drawing: `<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>` },
  "dots": { label: "Other", color: GRAPHITE, drawing: `<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>` },
};

// The transactions that have no category of their own get one of these instead, drawn the same way (not offered in
// the picker): movements between your accounts, reconciliations (what counting an account changed) and the money
// side of investment trades. Their colours are CSS ones, so a movement follows the accent colour of Settings.
const TYPE_ICONS = {
  movement: { color: "var(--accent)", drawing: `<path d="M4 8.5h15l-3.5-3.5M20 15.5H5l3.5 3.5"/>` },
  adjustment: { color: GRAPHITE, drawing: `<path d="M12 4v15M8 20h8M5 7.5h14M5 7.5l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7.5l-2.5 6a2.5 2.5 0 0 0 5 0z"/>` },
  investment: { color: INDIGO, drawing: `<path d="M3.5 17l5.5-5.5 4 4 7.5-7.5M15 8h5.5v5.5"/>` },
};

// A first guess from a new category's name (English and Italian words), so most new categories start with a
// fitting icon; the picker changes it. The first match wins. null: nothing fits, the initial it is.
const ICON_GUESSES = [
  [/grocer|supermarket|spesa|market/, "cart"],
  [/coffee|caff|espresso|cappucc/, "coffee"],
  [/food|restaurant|eat|dinner|lunch|pizza|ristorant|cibo|mangi|take ?away|delivery/, "fork-knife"],
  [/drink|beer|cocktail|aperitiv|bar\b|pub\b/, "drink"],
  [/rent|affitto|mortgage|mutuo|house|casa|home/, "home"],
  [/electric|power|luce|energ/, "bolt"],
  [/gas\b|heating|riscald/, "flame"],
  [/water|acqua/, "drop"],
  [/internet|wifi|wi-fi|fibra|broadband/, "wifi"],
  [/phone|mobile|cellul|telefon|sim\b/, "phone"],
  [/medic|pharma|farmac|pill|drug/, "pills"],
  [/health|doctor|medico|dentist|salute|visit/, "heart"],
  [/insur|assicur/, "shield"],
  [/tax|tass|bill|bollett|fee/, "receipt"],
  [/gift|regal|present/, "gift"],
  [/cloth|shoe|vestit|scarp|abbigl|fashion/, "shirt"],
  [/hair|barber|parrucch|beauty/, "scissors"],
  [/fuel|petrol|benzin|diesel|carburant/, "fuel"],
  [/car\b|auto|parking|parchegg|toll|pedagg/, "car"],
  [/train|treno|rail/, "train"],
  [/bike|bici|cycl/, "bike"],
  [/flight|plane|travel|trip|viagg|holiday|vacan|hotel/, "plane"],
  [/transport|bus\b|metro|tram|taxi|uber|commut|traspor/, "bus"],
  [/music|spotify|subscri|abbonam/, "music"],
  [/stream|netflix|tv\b|disney|prime/, "tv"],
  [/d&d|dnd|board ?game|dice|dadi/, "dice"],
  [/game|gaming|videogam|steam|playstation|xbox|nintendo/, "gamepad"],
  [/sport|gym|palestra|fitness|swim|calcio/, "dumbbell"],
  [/book|libr/, "book"],
  [/study|uni|school|course|corso|tuition|master|exam|esam/, "graduation"],
  [/pet|dog|cat\b|cane|gatto|vet/, "paw"],
  [/leisure|fun|cinema|movie|concert|event|svago|tempo libero|ticket/, "ticket"],
  [/product|amazon|shop|acquist|stuff|tech|gadget/, "box"],
  [/service|repair|riparaz|servizi|maintenance/, "wrench"],
  [/salary|stipend|wage|paycheck|office|lavoro|work/, "briefcase"],
  [/kiosk|chiosco|negozio|store/, "kiosk"],
  [/inps|pension|state|stato|government|benefit|bonus/, "landmark"],
  [/interest|interess|dividend|cedol/, "percent"],
  [/refund|rimbors|cashback|reso/, "refund"],
  [/voucher|buon|ticket restaurant|coupon/, "voucher"],
  [/income|entrat|other|altro|misc|vari/, "coins"],
];

// { icon, color } to start a new category with (both null when nothing fits)
export function guessCategoryLook(name) {
  const lowercaseName = String(name ?? "").toLowerCase();
  const [, icon] = ICON_GUESSES.find(([pattern]) => pattern.test(lowercaseName)) ?? [];
  return icon ? { icon, color: CATEGORY_ICONS[icon].color } : { icon: null, color: null };
}

const isKnownIcon = (icon) => Object.hasOwn(CATEGORY_ICONS, icon ?? "");
const isColor = (color) => /^#[0-9a-f]{6}$/i.test(color ?? "");

// The colour a category is drawn in: its own, or (none chosen) its icon's default, or one picked by its name
export function getCategoryColor({ name, icon, color }) {
  if (isColor(color)) return color;
  if (isKnownIcon(icon)) return CATEGORY_ICONS[icon].color;
  const hash = [...String(name ?? "")].reduce((sum, character) => (sum * 31 + character.codePointAt(0)) >>> 0, 7);
  return SLICE_COLORS[hash % SLICE_COLORS.length];
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// Just the white drawing, as an <svg> (it takes the text colour: the circle around it sets white).
// icon: a name from CATEGORY_ICONS, or { drawing } for the type icons.
export function createIconDrawing(icon) {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = (typeof icon === "string" ? CATEGORY_ICONS[icon] : icon).drawing; // the drawings above: fixed text written here, never anything typed in
  return svg;
}

// The round icon of a category ({ name, icon, color }, e.g. one of appState.categories): its drawing, or its initial
// when it has none, on its colour. className: "tx-icon" in the transaction lists, "category-icon" elsewhere
// (with "small" in the lists of Insights, Goals, Recurring and Home's quick add).
export function createCategoryIcon(category, className = "tx-icon") {
  const icon = createElement("span", className);
  icon.setAttribute("aria-hidden", "true");
  if (isKnownIcon(category.icon)) icon.append(createIconDrawing(category.icon));
  else icon.textContent = (String(category.name ?? "").trim()[0] ?? "·").toUpperCase();
  icon.style.setProperty("--icon-color", getCategoryColor(category));
  return icon;
}

// No category: a grey "?", so it reads as something still to sort out rather than as a category of its own
export function createUncategorizedIcon(className = "tx-icon") {
  const icon = createElement("span", `${className} uncategorized`, "?");
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

// The icon of a movement, reconciliation or investment trade (null for any other type)
export function createTypeIcon(type, className = "tx-icon") {
  if (!Object.hasOwn(TYPE_ICONS, type)) return null;
  const icon = createElement("span", className);
  icon.setAttribute("aria-hidden", "true");
  icon.append(createIconDrawing(TYPE_ICONS[type]));
  icon.style.setProperty("--icon-color", TYPE_ICONS[type].color);
  return icon;
}

// A category of appState.categories by id (an id kept offline may be text), or undefined
export const findCategory = (categoryId) =>
  categoryId == null || categoryId === "" ? undefined : appState.categories.find((category) => category.id === Number(categoryId));

// A category's name with its small icon in front, for the lists that name categories (Insights, budgets, trends,
// Goals). Only Pocket shows the icon (09-categories-page.css). name: what to write, when it isn't the category's
// own name (or there's no category: then the icon is the grey "?").
export function createCategoryLabel(categoryId, name) {
  const category = findCategory(categoryId);
  const label = createElement("span", "category-label");
  label.append(category ? createCategoryIcon(category, "category-icon small") : createUncategorizedIcon("category-icon small"),
    createElement("span", "category-label-text", name ?? category?.name ?? "Uncategorized"));
  return label;
}
