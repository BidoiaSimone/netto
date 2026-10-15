/* MIGRATION 10. Already applied to existing databases: never edit it, add a new migration instead. */

// ---- 10: tags ----
// A category says WHAT money was for (Food, Transport...); a tag says what it was PART OF ("Japan 2027"),
// across every category. So a transaction has at most one category but any number of tags: a many-to-many
// link, stored in its own table (transaction_tags) with one row per transaction + tag pair.
//
// A tag can have dates (a trip from 3 to 17 April): they don't limit anything, they only let the
// transaction dialog suggest the tag for transactions dated inside them.
//
// Both sides of a link are ids, never names (renaming a tag changes nothing else), and ON DELETE CASCADE
// on both: deleting a transaction or a tag removes its links, never the other side.
// Recurring transactions don't get tags: a rule repeats for years, a trip doesn't.
//
// Rebuilding `transactions` in a later migration (DROP + RENAME, like migrations 4 and 9) keeps these links:
// the runner switches foreign keys off while migrating, so the DROP doesn't cascade, and the ids are copied as they are.
function createTagsTables(db) {
  db.exec(`
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) > 0),  -- "japan 2027" = "Japan 2027"
      start_date TEXT,  -- YYYY-MM-DD, optional
      end_date TEXT,    -- YYYY-MM-DD, optional
      CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
    );

    CREATE TABLE transaction_tags (
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (transaction_id, tag_id)  -- the same tag can't be on a transaction twice
    ) WITHOUT ROWID;                          -- the two ids ARE the row: no hidden extra id needed

    -- the primary key already finds a transaction's tags fast; this finds a tag's transactions fast
    CREATE INDEX transaction_tags_by_tag ON transaction_tags(tag_id);
  `);
}

module.exports = createTagsTables;
