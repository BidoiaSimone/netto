const express = require("express");
const db = require("../../db/database.js");
const chalk = require("chalk");
const fs = require("fs");
const path = require("path");
const { toCents } = require("../money.js");
const { LATEST } = require("../../db/schema.js");

const router = express.Router();

router.get('/database', function(req, res) {

    var jsonRes = {};

    jsonRes.accounts = db.prepare(`SELECT * FROM accounts`).all(); // amounts in cents
    jsonRes.investments = db.prepare(`SELECT * FROM investments`).all();
    jsonRes.categories = db.prepare(`SELECT * FROM categories`).all();
    jsonRes.transactions = db.prepare(`SELECT * FROM transactions`).all();

    console.log(chalk.blue("\nAccounts:"));
    console.log(JSON.stringify(jsonRes.accounts, null, 2));

    console.log(chalk.blue("\nCategories:"));
    console.log(JSON.stringify(jsonRes.categories, null, 2));

    console.log(chalk.blue("\nTransactions:"));
    console.log(JSON.stringify(jsonRes.transactions, null, 2));

    console.log(chalk.blue("\nInvestments:"));
    console.log(JSON.stringify(jsonRes.investments, null, 2));
    res.json(jsonRes);
});

// Full backup of every table as a downloadable JSON file (used by the Settings page).
// The rows are exactly as stored: money in integer cents, accounts referenced by id.
// format_version is the database version (schema.js), so /import knows how to read the file.
router.get('/export', function(req, res) {
    res.attachment(`money-tracker-${new Date().toISOString().split("T")[0]}.json`);
    res.json({
        format_version: LATEST,
        money_unit: "cents",
        accounts: db.prepare(`SELECT * FROM accounts ORDER BY id`).all(),
        investments: db.prepare(`SELECT * FROM investments`).all(),
        categories: db.prepare(`SELECT * FROM categories`).all(),
        transactions: db.prepare(`SELECT * FROM transactions`).all(),
    });
});

// Restore a JSON backup made by /export. Replaces ALL current data.
// The current database is first saved to backend/db/backups/ so an import can always be undone.
// Older backups still work: those made before categories existed (a text `category`) and those
// made before version 2 (accounts by name, amounts in euros) are converted on the way in.
router.post('/import', async function(req, res) {
    const data = req.body;
    const tables = ["accounts", "investments", "transactions"];
    if (!data || !tables.every((t) => Array.isArray(data[t]))) {
        return res.status(400).json({ error: "Not a valid backup: expected accounts, investments and transactions lists." });
    }
    const categories = Array.isArray(data.categories) ? data.categories : [];

    try {
        const backupDir = path.join(__dirname, "../../db/backups");
        fs.mkdirSync(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await db.backup(path.join(backupDir, `before-import-${stamp}.db`));
    } catch (err) {
        return res.status(500).json({ error: "Could not save a safety copy, nothing was imported: " + err.message });
    }

    const pick = (row, cols, defaults = {}) =>
        Object.fromEntries(cols.map((c) => [c, row[c] ?? defaults[c] ?? null]));

    const insInvestment = db.prepare(`INSERT INTO investments (ticker, amount_invested, average_purchase_price, shares)
        VALUES (@ticker, @amount_invested, @average_purchase_price, @shares)`);
    const insCategory = db.prepare(`INSERT INTO categories (id, name) VALUES (@id, @name)`);
    // Every account starts at its opening balance: inserting the transactions afterwards lets the
    // triggers bring each balance to the right amount, so balances in the file are never trusted blindly
    const insAccount = db.prepare(`INSERT INTO accounts (id, name, kind, opening_balance, balance, open_date, last_reconciled)
        VALUES (@id, @name, @kind, @opening_balance, @opening_balance, @open_date, @last_reconciled)`);
    const insTransaction = db.prepare(`INSERT INTO transactions (id, from_account_id, to_account_id, type, amount, category_id, description, date)
        VALUES (@id, @from_account_id, @to_account_id, @type, @amount, @category_id, @description, @date)`);
    const findCategory = db.prepare(`SELECT id FROM categories WHERE name = ?`);
    const addCategory = db.prepare(`INSERT INTO categories (name) VALUES (?)`);

    // backups from before categories existed: category name -> id, creating it the first time it's seen
    const categoryIdFor = (name) => {
        const clean = String(name ?? "").trim();
        if (!clean) return null;
        return findCategory.get(clean)?.id ?? addCategory.run(clean).lastInsertRowid;
    };

    // Current format (version 2+): rows go in as they are (the balance is rebuilt by the triggers)
    function importCurrent() {
        for (const a of data.accounts) insAccount.run(pick(a, ["id", "name", "kind", "opening_balance", "open_date", "last_reconciled"], { kind: "cash" }));
        for (const t of data.transactions) {
            insTransaction.run(pick(t, ["id", "from_account_id", "to_account_id", "type", "amount", "category_id", "description", "date"]));
        }
    }

    // Old format (before version 2): accounts by name with a running `amount` in euros, transaction
    // amounts in euros. Same conversion as migration 2 in schema.js: names become ids, euros become
    // cents, and each account's opening balance is worked out backwards from its old amount.
    function importLegacy() {
        const ids = new Map(); // account name -> new id
        for (const a of data.accounts) {
            const row = pick(a, ["name", "kind", "open_date", "last_reconciled"], { kind: "cash" });
            ids.set(row.name, insAccount.run({ ...row, id: null, opening_balance: 0 }).lastInsertRowid);
        }
        const idOf = (name) => {
            if (name === null || name === undefined || name === "") return null;
            if (!ids.has(name)) throw new Error(`a transaction uses the account "${name}", which isn't in the backup`);
            return ids.get(name);
        };
        for (const t of data.transactions) {
            const row = pick(t, ["id", "type", "category_id", "description", "date"]);
            if (row.category_id === null) row.category_id = categoryIdFor(t.category);
            insTransaction.run({ ...row, from_account_id: idOf(t.from_account), to_account_id: idOf(t.to_account), amount: toCents(t.amount) });
        }
        // Each account started at 0 and the triggers added up its transactions into `balance`;
        // the old amount is the real balance, so the opening balance is the part not explained by them.
        const setOpening = db.prepare(`
            UPDATE accounts SET opening_balance = @amount - balance, balance = @amount WHERE id = @id`);
        for (const a of data.accounts) setOpening.run({ id: ids.get(a.name), amount: toCents(a.amount) });
    }

    const replaceAll = db.transaction(() => {
        db.exec(`DELETE FROM transactions; DELETE FROM categories; DELETE FROM investments; DELETE FROM accounts;`);
        for (const i of data.investments) insInvestment.run(pick(i, ["ticker", "amount_invested", "average_purchase_price", "shares"]));
        for (const c of categories) insCategory.run(pick(c, ["id", "name"]));
        if ((data.format_version ?? 0) >= 2) importCurrent();
        else importLegacy();
    });

    try {
        replaceAll(); // all or nothing: on any bad row the old data stays untouched
    } catch (err) {
        return res.status(400).json({ error: "Import failed, your data was not changed: " + err.message });
    }

    const n = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const result = { accounts: n("accounts"), investments: n("investments"), categories: n("categories"), transactions: n("transactions") };
    console.log(chalk.green(`Imported ${result.accounts} accounts, ${result.investments} investments, ${result.categories} categories, ${result.transactions} transactions`));
    res.json(result);
});

module.exports = router;
