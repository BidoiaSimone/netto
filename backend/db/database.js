/* FILE RESPONSIBLE FOR DATABASE SETUP */

const Database = require("better-sqlite3");
const path = require("path");
const { migrate, checkBalances } = require("./schema.js");

const dbPath = path.join(__dirname, "money.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL"); // for performance
db.pragma("foreign_keys = ON");  // SQLite ignores REFERENCES (e.g. transactions -> accounts) unless this is on

migrate(db);       // brings the tables up to date (see schema.js)
checkBalances(db); // warns if a stored balance doesn't match its transactions

// Permits requires in other files
module.exports = db;
