/* FILE RESPONSIBLE FOR DATABASE SETUP */

const Database = require("better-sqlite3");
const path = require("path");
const { createTables } = require("./schema.js");

const dbPath = path.join(__dirname, "money.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL"); // for performance

createTables(db);

// Permits requires in other files
module.exports = db;
