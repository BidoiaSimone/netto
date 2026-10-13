/* DELETES EVERY TABLE AND CREATES THEM AGAIN EMPTY.  Usage: node backend/db/clear-db.js --yes */

if (!process.argv.includes("--yes")) {
  console.log("This deletes ALL data in money.db. Run again with --yes to confirm.");
  process.exit(1);
}

const db = require("./database.js");
const { migrate } = require("./schema.js");

// The view and the tables that point to others go first
db.pragma("foreign_keys = OFF");
db.exec(`
  DROP VIEW IF EXISTS account_balances;
  DROP TABLE IF EXISTS transactions;
  DROP TABLE IF EXISTS categories;
  DROP TABLE IF EXISTS investments;
  DROP TABLE IF EXISTS accounts;
`);
db.pragma("user_version = 0"); // an empty database: every migration runs again
db.pragma("foreign_keys = ON");
migrate(db);

console.log("Database cleared.");
