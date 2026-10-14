/* THE NEXT UP LIST (Next up page), stored in the todos table (migration 5).
 * `done` is 0/1 in the database and true/false in the API.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { getTodayAsLocalDate } = require("../utils/localDates.js");

const router = express.Router();

const convertTodoRowForApi = (todoRow) => ({ ...todoRow, done: todoRow.done === 1 });
const cleanTodoText = (value) => (typeof value === "string" ? value.trim() : "");
const selectTodoById = db.prepare(`SELECT * FROM todos WHERE id = ?`);

// In the order they were added (open and done ones together; the page splits them)
router.get("/todos", function listTodos(request, response) {
  response.json(db.prepare(`SELECT * FROM todos ORDER BY id`).all().map(convertTodoRowForApi));
});

router.post("/todos", function addTodo(request, response) {
  const text = cleanTodoText(request.body?.text);
  if (!text) return response.status(400).json({ error: "the task needs some text" });
  const { lastInsertRowid } = db.prepare(`INSERT INTO todos (text, created_at) VALUES (?, ?)`).run(text, getTodayAsLocalDate());
  response.status(201).json(convertTodoRowForApi(selectTodoById.get(lastInsertRowid)));
});

// One-time move of the list the browser used to keep (localStorage). Only into an empty table,
// so opening the app in a second browser can never add its old list on top as duplicates.
router.post("/todos/import", function importTodosFromBrowser(request, response) {
  const items = Array.isArray(request.body?.items) ? request.body.items : null;
  if (!items) return response.status(400).json({ error: "items must be a list" });
  try {
    const importedCount = db.transaction(() => {
      if (db.prepare(`SELECT COUNT(*) AS n FROM todos`).get().n > 0) return null;
      const insertTodo = db.prepare(`INSERT INTO todos (text, done, created_at, done_at) VALUES (?, ?, ?, ?)`);
      const today = getTodayAsLocalDate();
      let count = 0;
      for (const item of items) {
        const text = cleanTodoText(item?.text);
        if (!text) continue;
        insertTodo.run(text, item.done ? 1 : 0, today, item.done ? today : null);
        count++;
      }
      return count;
    })();
    if (importedCount === null) return response.status(409).json({ error: "the list in the database isn't empty: nothing imported" });
    response.json({ imported: importedCount });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

// Change the text and/or tick / untick it
router.put("/todos/:id", function editTodo(request, response) {
  const todoId = Number(request.params.id);
  const existingTodo = selectTodoById.get(todoId);
  if (!existingTodo) return response.status(404).json({ error: "Task not found" });

  const text = request.body?.text === undefined ? existingTodo.text : cleanTodoText(request.body.text);
  if (!text) return response.status(400).json({ error: "the task needs some text" });
  const done = request.body?.done === undefined ? existingTodo.done : request.body.done ? 1 : 0;
  const doneAt = done ? (existingTodo.done ? existingTodo.done_at : getTodayAsLocalDate()) : null;

  db.prepare(`UPDATE todos SET text = ?, done = ?, done_at = ? WHERE id = ?`).run(text, done, doneAt, todoId);
  response.json(convertTodoRowForApi(selectTodoById.get(todoId)));
});

router.delete("/todos/:id", function deleteTodo(request, response) {
  const { changes } = db.prepare(`DELETE FROM todos WHERE id = ?`).run(Number(request.params.id));
  if (!changes) return response.status(404).json({ error: "Task not found" });
  response.json({ message: "Task deleted" });
});

module.exports = router;
