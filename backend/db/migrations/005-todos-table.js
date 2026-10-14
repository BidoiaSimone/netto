/* MIGRATION 5. Already applied to existing databases: never edit it, add a new migration instead.
 * (Function name before the refactor: todos) */

// ---- 5: the Next up list lives in the database ----
// It used to be kept by the browser (localStorage), so it wasn't in the backups and every browser
// had its own. The page imports its old browser list once, the first time it finds this table empty.
function createTodosTable(db) {
  db.exec(`
    CREATE TABLE todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,      -- also the order the tasks were added in
      text TEXT NOT NULL CHECK (length(trim(text)) > 0),
      done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
      created_at TEXT NOT NULL,                  -- YYYY-MM-DD
      done_at TEXT                               -- when it was ticked, NULL while open
    );
  `);
}

module.exports = createTodosTable;
