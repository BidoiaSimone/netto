// ---- the icon and colour picker of a category (Categories page) ----
// Opened by the round button before each category's name, and by the one in the "Add" forms. Shows every colour of
// core/categoryIcons.js, then every icon drawn in the chosen colour, with a preview of the result on top.
// It doesn't save anything itself: Done hands the choice to whoever opened it (categoriesPage.js).
//   icon null   no drawing: the category's initial (the "Aa" tile)
//   color null  "Auto": the icon's own colour, or one picked by the name when there's no icon

import { elementById, createElement } from "../core/domHelpers.js";
import { CATEGORY_ICONS, CATEGORY_COLORS, createCategoryIcon, createIconDrawing, getCategoryColor } from "../core/categoryIcons.js";

let pickedLook = { name: "", icon: null, color: null };
let whenChosen = null;

// look: { name, icon, color } to start from; onChoose({ icon, color }) runs on Done
export function openCategoryLookPicker(look, onChoose) {
  pickedLook = { name: look.name ?? "", icon: look.icon ?? null, color: look.color ?? null };
  whenChosen = onChoose;
  renderPicker();
  const dialog = elementById("category-look-dialog");
  dialog.showModal();
  dialog.querySelector(".look-icons [aria-checked=true]")?.focus();
}

function renderPicker() {
  const shownColor = getCategoryColor(pickedLook);
  elementById("look-preview-icon").replaceChildren(createCategoryIcon(pickedLook, "category-icon large"));
  elementById("look-preview-name").textContent = pickedLook.name || "New category";

  const autoSwatch = createChoiceButton("look-swatch auto", "Auto: the icon's own colour", pickedLook.color === null, () => pick({ color: null }));
  autoSwatch.textContent = "A";
  elementById("look-colors").replaceChildren(autoSwatch, ...CATEGORY_COLORS.map(({ color, label }) => {
    const swatch = createChoiceButton("look-swatch", label, pickedLook.color === color, () => pick({ color }));
    swatch.style.setProperty("--icon-color", color);
    return swatch;
  }));

  const initialTile = createChoiceButton("look-tile", "No icon: the name's initial", pickedLook.icon === null, () => pick({ icon: null }));
  initialTile.textContent = (pickedLook.name.trim()[0] ?? "A").toUpperCase();
  initialTile.style.setProperty("--icon-color", shownColor);
  elementById("look-icons").replaceChildren(initialTile, ...Object.entries(CATEGORY_ICONS).map(([icon, { label }]) => {
    const tile = createChoiceButton("look-tile", label, pickedLook.icon === icon, () => pick({ icon }));
    tile.append(createIconDrawing(icon));
    // every tile in the colour the category will have with that icon, so what you see is what you get
    tile.style.setProperty("--icon-color", getCategoryColor({ ...pickedLook, icon }));
    return tile;
  }));
}

// A round button of the picker, announced as a radio choice (with its name as tooltip and for VoiceOver)
function createChoiceButton(className, label, isChosen, onClick) {
  const button = createElement("button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", String(isChosen));
  button.addEventListener("click", onClick);
  return button;
}

function pick(change) {
  const focusedGroup = document.activeElement?.closest(".look-colors, .look-icons")?.id;
  const focusedIndex = focusedGroup ? [...elementById(focusedGroup).children].indexOf(document.activeElement) : -1;
  pickedLook = { ...pickedLook, ...change };
  renderPicker();
  if (focusedGroup) elementById(focusedGroup).children[focusedIndex]?.focus(); // redrawn: keep the keyboard where it was
}

export function initializeCategoryLookDialog() {
  elementById("category-look-form").addEventListener("submit", (event) => {
    event.preventDefault();
    elementById("category-look-dialog").close();
    whenChosen?.({ icon: pickedLook.icon, color: pickedLook.color });
  });
}
