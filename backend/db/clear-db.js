/* DROPS EVERY TABLE IN THE DATABASE AND THEN RUNS THE TABLES CREATIONS AGAIN */

// Dependencies
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.join(__dirname, "money.db");

// Database instantiation
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Failed to connect to database", err);
  } else {
    console.log("Connected to SQLite database from 'clear-db.js'");
  }
});

// Serialize waits for every db operation before starting the next one
db.serialize(() => {
    db.run(`DROP TABLE transactions`);
    db.run(`DROP TABLE investments`);
    db.run(`DROP TABLE accounts`, () => require('./database.js'));
});
