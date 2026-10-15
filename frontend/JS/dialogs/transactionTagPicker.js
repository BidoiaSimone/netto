// ---- the Tags field of the transaction dialog ----
// Built for speed, since transactions are added often:
//   type a few letters  -> the browser's own list (<datalist id="tag-names">) offers the existing tags
//   Enter or comma      -> the typed name becomes a chip; Enter on an EMPTY field still saves the transaction
//   Backspace           -> on an empty field, removes the last chip
//   a name not in the list is fine: it becomes a "new" chip, and the server creates the tag when the
//   transaction is saved (in the same step, so a refused transaction never leaves an unused tag behind)
// Under the field, tags whose dates contain the transaction's date are suggested: one click adds them.
//
// Tags are kept by id once they exist; only new ones travel by name (new_tag_names).

import { elementById, createElement } from "../core/domHelpers.js";
import { getTodayAsLocalDate } from "../core/formatting.js";
import { appState } from "../core/appState.js";

const MAXIMUM_SUGGESTIONS = 3;

let pickedTags = []; // [{ id, name }]; id is null for a name that doesn't exist yet
let isPickerDisabled = false;

const sameName = (first, second) => first.toLowerCase() === second.toLowerCase();
// "  Japan   2027 " -> "Japan 2027", the same cleaning the server does
const cleanTagName = (name) => name.trim().replace(/\s+/g, " ");
const findExistingTagByName = (name) => appState.tags.find((tag) => sameName(tag.name, name));

// ---------- the chips ----------

function renderPickedTags() {
  const chipsContainer = elementById("tx-tag-chips");
  chipsContainer.replaceChildren(...pickedTags.map((tag) => {
    const chip = createElement("span", tag.id === null ? "tag-chip new" : "tag-chip", tag.name);
    if (tag.id === null) chip.title = "New tag: created when the transaction is saved";
    if (!isPickerDisabled) {
      const removeButton = createElement("button", "tag-chip-remove", "×");
      removeButton.type = "button";
      removeButton.setAttribute("aria-label", `Remove tag ${tag.name}`);
      removeButton.onclick = () => removePickedTag(tag);
      chip.append(removeButton);
    }
    return chip;
  }));
  renderTagSuggestions();
}

function addPickedTagByName(typedName) {
  const name = cleanTagName(typedName.replace(/,/g, " "));
  if (!name || pickedTags.some((tag) => sameName(tag.name, name))) return;
  const existingTag = findExistingTagByName(name);
  pickedTags.push(existingTag ? { id: existingTag.id, name: existingTag.name } : { id: null, name });
  renderPickedTags();
}

function removePickedTag(tagToRemove) {
  pickedTags = pickedTags.filter((tag) => tag !== tagToRemove);
  renderPickedTags();
}

// ---------- suggestions from the tags' dates ----------

// A tag with at least one date fits a day inside them (an open side has no limit). A tag without dates never fits.
function tagDatesContain(tag, day) {
  if (!tag.start_date && !tag.end_date) return false;
  return (!tag.start_date || day >= tag.start_date) && (!tag.end_date || day <= tag.end_date);
}

function renderTagSuggestions() {
  const suggestionsLine = elementById("tx-tag-suggestions");
  const transactionDay = elementById("tx-date").value || getTodayAsLocalDate();
  const suggestedTags = isPickerDisabled ? [] : appState.tags
    .filter((tag) => tagDatesContain(tag, transactionDay) && !pickedTags.some((picked) => picked.id === tag.id))
    .slice(0, MAXIMUM_SUGGESTIONS);
  suggestionsLine.hidden = suggestedTags.length === 0;
  suggestionsLine.replaceChildren(createElement("span", "hint small", "Dates match:"), ...suggestedTags.map((tag) => {
    const suggestionButton = createElement("button", "ghost tag-suggestion", `+ ${tag.name}`);
    suggestionButton.type = "button";
    suggestionButton.onclick = () => {
      pickedTags.push({ id: tag.id, name: tag.name });
      renderPickedTags();
      elementById("tx-tag-input").focus();
    };
    return suggestionButton;
  }));
}

// ---------- used by the transaction dialog ----------

// The tags of the transaction being edited (from GET /transactions), or [] for a new one
export function setPickedTags(tags) {
  pickedTags = (tags ?? []).map((tag) => ({ id: tag.id, name: tag.name }));
  elementById("tx-tag-input").value = "";
  renderPickedTags();
}

// The cash side of a trade can't be changed here: its tags are shown but locked
export function setTagPickerDisabled(shouldDisable) {
  isPickerDisabled = shouldDisable;
  elementById("tx-tag-input").disabled = shouldDisable;
  renderPickedTags();
}

// Called when the date changes or the tag list reloads
export const refreshTagSuggestions = renderTagSuggestions;

// The picked tags in the API's shape. A name still in the field (typed, but Enter not pressed) counts too.
export function readPickedTags() {
  const pendingName = elementById("tx-tag-input").value;
  if (cleanTagName(pendingName)) {
    addPickedTagByName(pendingName);
    elementById("tx-tag-input").value = "";
  }
  return {
    tag_ids: pickedTags.filter((tag) => tag.id !== null).map((tag) => tag.id),
    new_tag_names: pickedTags.filter((tag) => tag.id === null).map((tag) => tag.name),
  };
}

// The list the browser offers while typing (every existing tag)
export function fillTagNameList() {
  elementById("tag-names").replaceChildren(...appState.tags.map((tag) => new Option(tag.name)));
  // a "new" chip whose tag now exists (e.g. created by another window) becomes the real one
  pickedTags = pickedTags.map((tag) => {
    const existingTag = tag.id === null ? findExistingTagByName(tag.name) : null;
    return existingTag ? { id: existingTag.id, name: existingTag.name } : tag;
  });
  renderPickedTags();
}

export function initializeTransactionTagPicker() {
  const tagInput = elementById("tx-tag-input");
  tagInput.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === ",") && tagInput.value.trim()) {
      event.preventDefault(); // Enter adds the tag instead of saving the transaction
      addPickedTagByName(tagInput.value);
      tagInput.value = "";
    } else if (event.key === "Backspace" && !tagInput.value && pickedTags.length) {
      pickedTags.pop();
      renderPickedTags();
    }
  });
  // Picking a name from the browser's list fills the whole field at once: add it straight away
  tagInput.addEventListener("input", (event) => {
    const pickedFromList = event.inputType === undefined || event.inputType === "insertReplacementText";
    if (pickedFromList && findExistingTagByName(cleanTagName(tagInput.value))) {
      addPickedTagByName(tagInput.value);
      tagInput.value = "";
    }
  });
  elementById("tx-date").addEventListener("input", renderTagSuggestions);
  // a click anywhere on the field (not only on the small input) starts typing
  elementById("tx-tag-field").addEventListener("click", (event) => { if (event.target === event.currentTarget) tagInput.focus(); });
}
