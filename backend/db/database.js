/* FILE RESPONSIBLE FOR DATABSE SETUP */

// Dependencies
const sqlite3 = require("better-sqlite3");
const path = require("path");
const dbPath = path.join(__dirname, "money.db");

// Database instantiation
const db = require('better-sqlite3')(dbPath);
// For performance
db.pragma('journal_mode = WAL');

// Creating database tables
db.prepare(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_account TEXT,
        to_account TEXT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'movement')),
        amount REAL NOT NULL CHECK (amount > 0),
        description TEXT,
        date TEXT NOT NULL,
        CHECK (from_account IS NOT NULL OR to_account IS NOT NULL)
      )`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS investments(
        ticker TEXT PRIMARY KEY,
        amount_invested REAL NOT NULL,
        average_purchase_price REAL NOT NULL,
        shares REAL NOT NULL
        )`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS accounts(
        name TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        open_date TEXT NOT NULL
        )`).run();
 
// Permits requires in other files
module.exports = db;