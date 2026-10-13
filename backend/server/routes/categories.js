const express = require("express");
const db = require("../../db/database.js");

const router = express.Router();

const cleanName = (n) => String(n ?? "").trim().replace(/\s+/g, " ");
const findByName = db.prepare(`SELECT id, name FROM categories WHERE name = ?`); // NOCASE column: "coffee" finds "Coffee"

// Every category with how many transactions use it (so the page can warn before deleting)
router.get("/categories", function (req, res) {
  res.json(db.prepare(`
    SELECT c.id, c.name, COUNT(t.id) AS used
    FROM categories c LEFT JOIN transactions t ON t.category_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `).all());
});

router.post("/categories", function (req, res) {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: "name is required" });

  const existing = findByName.get(name);
  if (existing) return res.status(409).json({ error: `${existing.name} already exists` });

  const { lastInsertRowid } = db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(name);
  res.status(201).json({ id: lastInsertRowid, name });
});

// Rename. If the new name already belongs to another category, the answer is 409 with
// `merge_into`; sending the same request again with { merge: true } moves every transaction
// to that category and deletes this one (how "Cofee" gets folded into "Coffee").
router.put("/categories/:id", function (req, res) {
  const id = Number(req.params.id);
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: "name is required" });

  const current = db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(id);
  if (!current) return res.status(404).json({ error: "Category not found" });

  const other = findByName.get(name);
  if (other && other.id !== id) {
    if (!req.body?.merge) {
      return res.status(409).json({ error: `${other.name} already exists`, merge_into: other });
    }
    db.transaction(() => {
      db.prepare(`UPDATE transactions SET category_id = ? WHERE category_id = ?`).run(other.id, id);
      db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
    })();
    return res.json({ merged_into: other });
  }

  // same category: still allowed, so "coffee" -> "Coffee" fixes the capitalisation
  db.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(name, id);
  res.json({ id, name });
});

// Transactions that used it become uncategorized (ON DELETE SET NULL in schema.js)
router.delete("/categories/:id", function (req, res) {
  const { changes } = db.prepare(`DELETE FROM categories WHERE id = ?`).run(Number(req.params.id));
  if (!changes) return res.status(404).json({ error: "Category not found" });
  res.json({ message: "Category deleted" });
});

module.exports = router;
