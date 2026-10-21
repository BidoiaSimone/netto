/* CATEGORIES (Categories page): list, add, rename (or merge), move to the other kind, pick an icon and colour, delete.
 * Each category is either an income or an expense category (`kind`, migration 8). Names are unique
 * within a kind, so "Gift" can exist once as income and once as expense; everything else (transactions,
 * recurring transactions, the pages) refers to a category by its id, so renaming one changes nothing else.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");

const router = express.Router();

const CATEGORY_KINDS = ["income", "expense"];
const SPENDING_PACES = ["daily", "occasional"];

// A category's look (migration 21): the name of one of the drawings in frontend/JS/core/categoryIcons.js, and a
// "#rrggbb" colour. Only the shape is checked here: the list of drawings and colours lives with the frontend.
// null (or missing, or "") = none: the lists then show the initial, on a colour guessed from the name.
const ICON_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// { icon, color } from a request body, or { error } when one of them isn't valid
function readCategoryLook(body) {
  const icon = body?.icon || null, color = body?.color || null;
  if (icon !== null && !(typeof icon === "string" && ICON_NAME_PATTERN.test(icon))) return { error: "icon must be the name of an icon, e.g. \"cart\"" };
  if (color !== null && !(typeof color === "string" && COLOR_PATTERN.test(color))) return { error: "color must be a colour like #2f9e44" };
  return { icon, color: color && color.toLowerCase() };
}

// Trims and collapses repeated spaces: "  Eating   out " -> "Eating out"
const cleanCategoryName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");
// NOCASE column: "coffee" finds "Coffee"
const selectCategoryByNameAndKind = db.prepare(`SELECT id, name, kind FROM categories WHERE name = ? AND kind = ?`);

// Every category with how many transactions and recurring transactions use it
// (so the page can warn before deleting), expense ones first, then by name.
// spending_pace: "daily" or "occasional", how the month projections treat it (migration 16).
// monthly_budget: this month's limit in euros (migration 11), null when there is none (always null for income).
// icon, color: its look in the lists (migration 21), each null when not chosen.
router.get("/categories", function listCategories(request, response) {
  const categoryRows = db.prepare(`
    SELECT c.id, c.name, c.kind, c.spending_pace, c.icon, c.color,
           (SELECT COUNT(*) FROM transactions WHERE category_id = c.id) AS used,
           (SELECT COUNT(*) FROM recurring_transactions WHERE category_id = c.id) AS used_by_recurring,
           CASE WHEN c.kind = 'expense' THEN (
             SELECT monthly_limit FROM category_budgets WHERE category_id = c.id AND from_month <= $month
             ORDER BY from_month DESC LIMIT 1
           ) END AS monthly_budget
    FROM categories c
    ORDER BY c.kind = 'income', c.name
  `).all({ month: getTodayAsLocalDate().slice(0, 7) });
  response.json(categoryRows.map((category) => ({ ...category, monthly_budget: convertCentsToEuros(category.monthly_budget) })));
});

// { name, kind: "income" | "expense", icon?, color? }
router.post("/categories", function addCategory(request, response) {
  const name = cleanCategoryName(request.body?.name);
  const kind = request.body?.kind;
  if (!name) return response.status(400).json({ error: "name is required" });
  if (!CATEGORY_KINDS.includes(kind)) return response.status(400).json({ error: "kind must be income or expense" });
  const look = readCategoryLook(request.body);
  if (look.error) return response.status(400).json({ error: look.error });

  const existingCategory = selectCategoryByNameAndKind.get(name, kind);
  if (existingCategory) return response.status(409).json({ error: `${existingCategory.name} already exists among the ${kind} categories` });

  const { lastInsertRowid } = db.prepare(`INSERT INTO categories (name, kind, icon, color) VALUES (?, ?, ?, ?)`).run(name, kind, look.icon, look.color);
  response.status(201).json({ id: lastInsertRowid, name, kind, icon: look.icon, color: look.color });
});

// Rename (the kind stays). If the new name already belongs to another category of the same kind, the
// answer is 409 with `merge_into`; sending the same request again with { merge: true } moves every
// transaction (and recurring transaction) to that category and deletes this one ("Cofee" into "Coffee").
router.put("/categories/:id", function renameOrMergeCategory(request, response) {
  const categoryId = Number(request.params.id);
  const newName = cleanCategoryName(request.body?.name);
  if (!newName) return response.status(400).json({ error: "name is required" });

  const currentCategory = db.prepare(`SELECT id, name, kind FROM categories WHERE id = ?`).get(categoryId);
  if (!currentCategory) return response.status(404).json({ error: "Category not found" });

  const categoryWithNewName = selectCategoryByNameAndKind.get(newName, currentCategory.kind);
  if (categoryWithNewName && categoryWithNewName.id !== categoryId) {
    if (!request.body?.merge) {
      return response.status(409).json({ error: `${categoryWithNewName.name} already exists`, merge_into: categoryWithNewName });
    }
    db.transaction(() => {
      db.prepare(`UPDATE transactions SET category_id = ? WHERE category_id = ?`).run(categoryWithNewName.id, categoryId);
      db.prepare(`UPDATE recurring_transactions SET category_id = ? WHERE category_id = ?`).run(categoryWithNewName.id, categoryId);
      // goals funded by this category keep it under its new name (a goal that had both keeps the target's baseline)
      db.prepare(`INSERT OR IGNORE INTO savings_goal_categories (goal_id, category_id, monthly_baseline)
                  SELECT goal_id, ?, monthly_baseline FROM savings_goal_categories WHERE category_id = ?`).run(categoryWithNewName.id, categoryId);
      db.prepare(`DELETE FROM categories WHERE id = ?`).run(categoryId);
    })();
    return response.json({ merged_into: categoryWithNewName });
  }

  // same category: still allowed, so "coffee" -> "Coffee" fixes the capitalisation
  db.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(newName, categoryId);
  response.json({ id: categoryId, name: newName, kind: currentCategory.kind });
});

// Moves a category to the other list: { kind: "income" | "expense" } (an "Income - INPS" that ended up
// among the expenses). The id stays the same, so whatever already uses it keeps using it.
// Refused while an income or expense of the current kind uses it: an expense can't have an income
// category, so those must move to another category first. Movements and reconciliations may use either
// kind, so they don't block it. Also refused if the other list already has a category with this name.
router.put("/categories/:id/kind", function moveCategoryToOtherKind(request, response) {
  const categoryId = Number(request.params.id);
  const newKind = request.body?.kind;
  if (!CATEGORY_KINDS.includes(newKind)) return response.status(400).json({ error: "kind must be income or expense" });

  const category = db.prepare(`SELECT id, name, kind FROM categories WHERE id = ?`).get(categoryId);
  if (!category) return response.status(404).json({ error: "Category not found" });
  if (category.kind === newKind) return response.json(category);

  const usesOfCurrentKind = db.prepare(`
    SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = $id AND type = $kind)
         + (SELECT COUNT(*) FROM recurring_transactions WHERE category_id = $id AND type = $kind) AS count
  `).get({ id: categoryId, kind: category.kind }).count;
  if (usesOfCurrentKind) {
    return response.status(409).json({
      error: `${category.name} is used by ${usesOfCurrentKind} ${category.kind}${usesOfCurrentKind === 1 ? "" : "s"}, `
        + `which need an ${category.kind} category: give them another category first, or add a new ${newKind} category instead`,
    });
  }

  const sameNameInNewKind = selectCategoryByNameAndKind.get(category.name, newKind);
  if (sameNameInNewKind) {
    return response.status(409).json({ error: `${sameNameInNewKind.name} already exists among the ${newKind} categories: rename one of the two first` });
  }

  db.prepare(`UPDATE categories SET kind = ? WHERE id = ?`).run(newKind, categoryId);
  response.json({ ...category, kind: newKind });
});

// How an expense category is spent: { spending_pace: "daily" | "occasional" } (migration 16).
// daily: the month projections carry on at this month's pace; occasional (rent, gifts, a new phone): what's
// spent so far is all they count, since one purchase says nothing about the rest of the month.
router.put("/categories/:id/spending-pace", function setCategorySpendingPace(request, response) {
  const categoryId = Number(request.params.id);
  const spendingPace = request.body?.spending_pace;
  if (!SPENDING_PACES.includes(spendingPace)) return response.status(400).json({ error: "spending_pace must be daily or occasional" });

  const category = db.prepare(`SELECT id, name, kind FROM categories WHERE id = ?`).get(categoryId);
  if (!category) return response.status(404).json({ error: "Category not found" });
  if (category.kind !== "expense") return response.status(400).json({ error: "Only expense categories have a spending pace" });

  db.prepare(`UPDATE categories SET spending_pace = ? WHERE id = ?`).run(spendingPace, categoryId);
  response.json({ ...category, spending_pace: spendingPace });
});

// Its icon and colour: { icon, color } (migration 21), both always sent; null = none (the initial, the guessed colour).
// A merge keeps the look of the category that stays.
router.put("/categories/:id/look", function setCategoryLook(request, response) {
  const categoryId = Number(request.params.id);
  const look = readCategoryLook(request.body);
  if (look.error) return response.status(400).json({ error: look.error });

  const category = db.prepare(`SELECT id, name, kind FROM categories WHERE id = ?`).get(categoryId);
  if (!category) return response.status(404).json({ error: "Category not found" });

  db.prepare(`UPDATE categories SET icon = ?, color = ? WHERE id = ?`).run(look.icon, look.color, categoryId);
  response.json({ ...category, icon: look.icon, color: look.color });
});

// Transactions and recurring transactions that used it become uncategorized (ON DELETE SET NULL)
router.delete("/categories/:id", function deleteCategory(request, response) {
  const { changes } = db.prepare(`DELETE FROM categories WHERE id = ?`).run(Number(request.params.id));
  if (!changes) return response.status(404).json({ error: "Category not found" });
  response.json({ message: "Category deleted" });
});

module.exports = router;
