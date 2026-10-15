/* THE TAGS OF EACH TRANSACTION (the transaction_tags links, migration 10)
 * Saving a transaction's tags replaces its links with the new list; reading gives every transaction's tags
 * at once, for GET /transactions.
 */

const db = require("../../db/databaseConnection.js");

// NOCASE column: "japan 2027" finds "Japan 2027"
const selectTagIdByName = db.prepare(`SELECT id FROM tags WHERE name = ?`);
const insertTag = db.prepare(`INSERT INTO tags (name) VALUES (?)`);
const deleteLinksOfTransaction = db.prepare(`DELETE FROM transaction_tags WHERE transaction_id = ?`);
const insertLink = db.prepare(`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`);

// A typed name may already exist (typed again, or with other capitals): then that tag is used, not a duplicate
const findOrCreateTagId = (name) => selectTagIdByName.get(name)?.id ?? insertTag.run(name).lastInsertRowid;

// Call inside db.transaction(), right after the transaction is saved.
// tagSelection: from validateTransactionTags(); null = leave the tags as they are.
function saveTagsOfTransaction(transactionId, tagSelection) {
  if (!tagSelection) return;
  const tagIds = [...tagSelection.tagIds, ...tagSelection.newTagNames.map(findOrCreateTagId)];
  deleteLinksOfTransaction.run(transactionId);
  for (const tagId of tagIds) insertLink.run(transactionId, tagId); // OR IGNORE: the same tag twice is kept once
}

// Map: transaction id -> [{ id, name }] sorted by name. Transactions without tags aren't in it.
function loadTagsOfEveryTransaction() {
  const tagsByTransactionId = new Map();
  const links = db.prepare(`
    SELECT tt.transaction_id, t.id, t.name FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id
    ORDER BY t.name COLLATE NOCASE
  `).all();
  for (const link of links) {
    if (!tagsByTransactionId.has(link.transaction_id)) tagsByTransactionId.set(link.transaction_id, []);
    tagsByTransactionId.get(link.transaction_id).push({ id: link.id, name: link.name });
  }
  return tagsByTransactionId;
}

module.exports = { saveTagsOfTransaction, loadTagsOfEveryTransaction };
