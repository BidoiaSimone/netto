/* DROPS EVERY TABLE AND CREATES THEM AGAIN EMPTY.  Usage: node backend/db/clear-db.js --yes */

if (!process.argv.includes("--yes")) {
  console.log("This deletes ALL data in money.db. Run again with --yes to confirm.");
  process.exit(1);
}

const db = require("./database.js");
const { createTables } = require("./schema.js");

db.exec(`
  DROP TABLE IF EXISTS transactions;
  DROP TABLE IF EXISTS investments;
  DROP TABLE IF EXISTS accounts;
`);
createTables(db);

console.log("Database cleared.");
