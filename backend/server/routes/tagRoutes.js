/* TAGS: list, add, rename (or merge), change dates, delete, and what each one adds up to.
 * A tag groups transactions across categories ("Japan 2027": flights, hotels, food...). Transactions get
 * their tags when they are added or edited (transactionRoutes.js); this file manages the tags themselves.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { validateTag } = require("../validation/tagValidation.js");
const { buildTagReport } = require("../services/tagReport.js");

const router = express.Router();

// NOCASE column: "japan 2027" finds "Japan 2027"
const selectTagByName = db.prepare(`SELECT id, name FROM tags WHERE name = ?`);
const selectTagById = db.prepare(`SELECT id, name, start_date, end_date FROM tags WHERE id = ?`);

// Every tag with how many transactions use it (so the page can warn before deleting), by name
router.get("/tags", function listTags(request, response) {
  response.json(db.prepare(`
    SELECT t.id, t.name, t.start_date, t.end_date,
           (SELECT COUNT(*) FROM transaction_tags WHERE tag_id = t.id) AS used
    FROM tags t ORDER BY t.name COLLATE NOCASE
  `).all());
});

// Spent, received, net, dates and categories of every tag (services/tagReport.js)
router.get("/tags/report", function getTagReport(request, response) {
  response.json(buildTagReport());
});

// { name, start_date?, end_date? }
router.post("/tags", function addTag(request, response) {
  const { error, tag } = validateTag(request.body);
  if (error) return response.status(400).json({ error });
  const existingTag = selectTagByName.get(tag.name);
  if (existingTag) return response.status(409).json({ error: `${existingTag.name} already exists` });

  const { lastInsertRowid } = db.prepare(`INSERT INTO tags (name, start_date, end_date) VALUES (?, ?, ?)`).run(tag.name, tag.startDate, tag.endDate);
  response.status(201).json({ id: lastInsertRowid, name: tag.name, start_date: tag.startDate, end_date: tag.endDate });
});

// Rename and / or change the dates: { name, start_date, end_date } (the whole tag, like adding one).
// If the new name already belongs to another tag, the answer is 409 with `merge_into`, like categories;
// sending the same request again with { merge: true } moves this tag's transactions to that one and
// deletes this one ("Japan" into "Japan 2027"). A transaction that had both keeps just the one.
router.put("/tags/:id", function editOrMergeTag(request, response) {
  const tagId = Number(request.params.id);
  const currentTag = selectTagById.get(tagId);
  if (!currentTag) return response.status(404).json({ error: "Tag not found" });
  const { error, tag } = validateTag(request.body);
  if (error) return response.status(400).json({ error });

  const tagWithNewName = selectTagByName.get(tag.name);
  if (tagWithNewName && tagWithNewName.id !== tagId) {
    if (!request.body?.merge) return response.status(409).json({ error: `${tagWithNewName.name} already exists`, merge_into: tagWithNewName });
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) SELECT transaction_id, ? FROM transaction_tags WHERE tag_id = ?`)
        .run(tagWithNewName.id, tagId);
      db.prepare(`DELETE FROM tags WHERE id = ?`).run(tagId); // its own links go with it (ON DELETE CASCADE)
    })();
    return response.json({ merged_into: tagWithNewName });
  }

  // same tag: still allowed, so "japan 2027" -> "Japan 2027" fixes the capitalisation
  db.prepare(`UPDATE tags SET name = ?, start_date = ?, end_date = ? WHERE id = ?`).run(tag.name, tag.startDate, tag.endDate, tagId);
  response.json({ id: tagId, name: tag.name, start_date: tag.startDate, end_date: tag.endDate });
});

// The transactions stay; only their link to this tag goes (ON DELETE CASCADE)
router.delete("/tags/:id", function deleteTag(request, response) {
  const { changes } = db.prepare(`DELETE FROM tags WHERE id = ?`).run(Number(request.params.id));
  if (!changes) return response.status(404).json({ error: "Tag not found" });
  response.json({ message: "Tag deleted" });
});

module.exports = router;
