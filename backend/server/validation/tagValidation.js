/* CHECKS TAGS SENT BY THE FRONTEND
 *   validateTag()              a tag itself (Categories page): name and optional trip dates
 *   validateTransactionTags()  the tags chosen for a transaction (transaction dialog)
 */

const db = require("../../db/databaseConnection.js");
const { isRealCalendarDate } = require("../utils/localDates.js");

const MAXIMUM_TAG_NAME_LENGTH = 60;

// Trims and collapses repeated spaces: "  Japan   2027 " -> "Japan 2027" (same cleaning as category names)
const cleanTagName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");

function findTagNameError(name) {
  if (!name) return "a tag needs a name";
  if (name.length > MAXIMUM_TAG_NAME_LENGTH) return `a tag name can be at most ${MAXIMUM_TAG_NAME_LENGTH} characters`;
  return null;
}

// Empty = no date. Returns { date } or { error }.
function parseOptionalTagDate(dateText, label) {
  if (dateText === undefined || dateText === null || dateText === "") return { date: null };
  return isRealCalendarDate(dateText) ? { date: dateText } : { error: `${label} must be a valid YYYY-MM-DD date` };
}

// { name, start_date?, end_date? } -> { tag: { name, startDate, endDate } } or { error }
function validateTag(requestBody = {}) {
  const name = cleanTagName(requestBody.name);
  const nameError = findTagNameError(name);
  if (nameError) return { error: nameError };
  const start = parseOptionalTagDate(requestBody.start_date, "start date");
  if (start.error) return { error: start.error };
  const end = parseOptionalTagDate(requestBody.end_date, "end date");
  if (end.error) return { error: end.error };
  if (start.date && end.date && end.date < start.date) return { error: "the end date can't be before the start date" };
  return { tag: { name, startDate: start.date, endDate: end.date } };
}

// The tags of a transaction, as sent with it:
//   tag_ids        ids of existing tags (the usual case: picked from the list)
//   new_tag_names  names typed in the dialog that weren't in the list yet: created when the transaction is saved,
//                  in the same database transaction, so a refused transaction never leaves an unused new tag behind
// Neither sent at all = the tags are left as they are (an edit that doesn't mention tags keeps them).
// Returns { tagSelection: { tagIds, newTagNames } | null } or { error }.
function validateTransactionTags(requestBody = {}) {
  if (requestBody.tag_ids === undefined && requestBody.new_tag_names === undefined) return { tagSelection: null };

  const tagIdsSent = requestBody.tag_ids ?? [];
  const newTagNamesSent = requestBody.new_tag_names ?? [];
  if (!Array.isArray(tagIdsSent) || !Array.isArray(newTagNamesSent)) return { error: "tag_ids and new_tag_names must be lists" };

  const tagIds = [...new Set(tagIdsSent.map(Number))];
  for (const tagId of tagIds) {
    if (!Number.isInteger(tagId) || !db.prepare(`SELECT 1 FROM tags WHERE id = ?`).get(tagId)) return { error: `Unknown tag id: ${tagId}` };
  }
  const newTagNames = [];
  for (const nameSent of newTagNamesSent) {
    const name = cleanTagName(nameSent);
    const nameError = findTagNameError(name);
    if (nameError) return { error: nameError };
    const alreadyListed = newTagNames.some((listedName) => listedName.toLowerCase() === name.toLowerCase());
    if (!alreadyListed) newTagNames.push(name);
  }
  return { tagSelection: { tagIds, newTagNames } };
}

module.exports = { validateTag, validateTransactionTags, cleanTagName };
