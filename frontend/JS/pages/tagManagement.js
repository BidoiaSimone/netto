// ---- Tags, on the Categories page: add, rename (or merge), change the dates, delete ----
// Each row is editable in place, like the categories: change a name or a date and it's saved as soon as
// you leave the field (Enter works too). Loading the tags here also feeds the transaction dialog's list,
// the Transactions page filter and Insights > Tags.

import { elementById, createElement, fillTableBody } from "../core/domHelpers.js";
import { formatCount } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { runThenReloadAllData } from "../core/dataRefresh.js";
import { fillTagNameList, refreshTagSuggestions } from "../dialogs/transactionTagPicker.js";
import { fillTagFilter } from "./transactionsPage.js";
import { renderTagInsights } from "./tagInsights.js";
import { t } from "../core/i18n.js";

export async function loadTags() {
  [appState.tags, appState.tagReport] = await Promise.all([callApi("/tags"), callApi("/tags/report")]);
  renderTagManagement();
  fillTagNameList();
  refreshTagSuggestions();
  fillTagFilter();
  renderTagInsights();
}

function renderTagManagement() {
  // an auto refresh must not wipe a name or a date you are in the middle of changing
  if (document.activeElement?.closest("#tags-body")) return;
  elementById("tags-empty").hidden = appState.tags.length > 0;
  fillTableBody("tags-body", appState.tags, (tag) => [
    createTagFieldInput(tag, "name"),
    createTagFieldInput(tag, "start_date"),
    createTagFieldInput(tag, "end_date"),
    tag.used ? formatCount(tag.used, "transaction") : t("not used yet"),
    createDeleteTagButton(tag),
  ]);
}

const FIELD_LABELS = { name: t("tag name"), start_date: t("first day"), end_date: t("last day") };

// One editable cell: the name (text) or a date. Any change saves the whole tag (PUT /tags/:id).
function createTagFieldInput(tag, fieldName) {
  const input = createElement("input");
  input.type = fieldName === "name" ? "text" : "date";
  input.value = tag[fieldName] ?? "";
  input.setAttribute("aria-label", `${tag.name}: ${FIELD_LABELS[fieldName]}`);
  input.addEventListener("change", () => {
    const newValue = fieldName === "name" ? input.value.trim() : input.value;
    if (fieldName === "name" && !newValue) { input.value = tag.name; return; }
    if (newValue === (tag[fieldName] ?? "")) return;
    saveTag(tag, { name: tag.name, start_date: tag.start_date, end_date: tag.end_date, [fieldName]: newValue || null });
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur(); // blur fires "change"
    if (event.key === "Escape") { input.value = tag[fieldName] ?? ""; input.blur(); }
  });
  return input;
}

// If the new name already belongs to another tag, the server answers 409 + merge_into: ask, then merge
function saveTag(tag, editedTag) {
  runThenReloadAllData(async () => {
    try {
      await callApi(`/tags/${tag.id}`, { method: "PUT", body: editedTag });
    } catch (error) {
      const mergeTarget = error.data?.merge_into;
      if (!mergeTarget) throw error;
      const movingTransactions = tag.used ? " " + t("Its {transactions} will get \"{target}\" instead.", { transactions: formatCount(tag.used, "transaction"), target: mergeTarget.name }) : "";
      if (!confirm(t("\"{target}\" already exists. Merge \"{name}\" into it?", { target: mergeTarget.name, name: tag.name }) + movingTransactions)) return; // the reload puts the old name back
      await callApi(`/tags/${tag.id}`, { method: "PUT", body: { ...editedTag, merge: true } });
    }
  });
}

function createDeleteTagButton(tag) {
  const deleteButton = createElement("button", "", t("Delete"));
  deleteButton.type = "button";
  deleteButton.onclick = () => {
    const confirmation = tag.used
      ? t("Delete the tag \"{name}\"? Its {transactions} stay, just without this tag.", { name: tag.name, transactions: formatCount(tag.used, "transaction") })
      : t("Delete the tag \"{name}\"?", { name: tag.name });
    if (confirm(confirmation)) runThenReloadAllData(() => callApi(`/tags/${tag.id}`, { method: "DELETE" }));
  };
  return deleteButton;
}

export function initializeTagManagement() {
  elementById("tag-add-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    const newTag = { name: form.elements.name.value, start_date: form.elements.start_date.value || null, end_date: form.elements.end_date.value || null };
    runThenReloadAllData(async () => {
      await callApi("/tags", { method: "POST", body: newTag });
      form.reset();
    });
  });
}
