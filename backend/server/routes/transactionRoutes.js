/* TRANSACTIONS: list, add, edit, delete.
 * The account balances follow by themselves: database triggers (migration 3) update them
 * every time a transaction is added, changed or deleted, so there is nothing to do here for that.
 * Tags (migration 10) are saved with the transaction, in the same database transaction: both or neither.
 */

const express = require("express");
const db = require("../../db/databaseConnection.js");
const { convertCentsToEuros } = require("../utils/moneyConversion.js");
const { validateTransaction, validateTransactionDetails } = require("../validation/transactionValidation.js");
const { validateTransactionTags } = require("../validation/tagValidation.js");
const { saveTagsOfTransaction, loadTagsOfEveryTransaction } = require("../services/transactionTags.js");

const router = express.Router();

// The cash side of an investment trade belongs to the trade: changing it here would make the
// holding and the account disagree. It is edited or deleted with its trade (investmentTradeRoutes.js).
const INVESTMENT_TRANSACTION_IS_LOCKED = "This is the cash side of an investment trade: change or delete the trade on the Investments page.";

const selectTransactionById = db.prepare(`SELECT type, from_account_id, to_account_id FROM transactions WHERE id = ?`);

// Account and category names are joined in so the frontend can show them;
// the *_id fields are what it should use to filter or send back. `tags`: [{ id, name }], [] when none.
router.get("/transactions", function listTransactions(request, response) {
  const transactionRows = db.prepare(`
    SELECT t.*, fa.name AS from_account, ta.name AS to_account, c.name AS category
    FROM transactions t
    LEFT JOIN accounts fa ON fa.id = t.from_account_id
    LEFT JOIN accounts ta ON ta.id = t.to_account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ORDER BY t.date DESC, t.id DESC
  `).all();
  const tagsByTransactionId = loadTagsOfEveryTransaction();
  response.json(transactionRows.map((transaction) => ({
    ...transaction,
    amount: convertCentsToEuros(transaction.amount),
    tags: tagsByTransactionId.get(transaction.id) ?? [],
  })));
});

// Tags: tag_ids (existing tags) and new_tag_names (typed in the dialog, created here); both optional
router.post("/transactions", function addTransaction(request, response) {
  const { error, transaction } = validateTransaction(request.body ?? {});
  if (error) return response.status(400).json({ error });
  const { error: tagError, tagSelection } = validateTransactionTags(request.body ?? {});
  if (tagError) return response.status(400).json({ error: tagError });

  try {
    const newTransactionId = db.transaction(() => {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO transactions (from_account_id, to_account_id, type, amount, category_id, description, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(transaction.fromAccountId, transaction.toAccountId, transaction.type, transaction.amount,
             transaction.categoryId, transaction.description, transaction.date);
      saveTagsOfTransaction(lastInsertRowid, tagSelection);
      return lastInsertRowid;
    })();
    response.status(201).json({ message: "Transaction added successfully", id: newTransactionId });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

// Edit a transaction. The body is the whole transaction, like when adding one.
// The update trigger undoes the old version on the account balances and applies the new one,
// so changing the amount or the accounts keeps every balance right.
//
// Reconciliation adjustments are the exception: their amount is the difference between what was
// recorded and what you counted that day, so changing it (or the account) would silently undo the
// reconciliation. Only their date, category, description and tags can change; delete one to undo it.
// Tags not sent at all are left as they are; an empty list removes them.
router.put("/transactions/:id", function editTransaction(request, response) {
  const transactionId = Number(request.params.id);
  const existingTransaction = selectTransactionById.get(transactionId);
  if (!existingTransaction) return response.status(404).json({ error: "Transaction not found" });
  if (existingTransaction.type === "investment") return response.status(400).json({ error: INVESTMENT_TRANSACTION_IS_LOCKED });

  const requestBody = request.body ?? {};
  try {
    if (existingTransaction.type === "adjustment") {
      editReconciliationDetails(transactionId, requestBody, response);
    } else {
      editWholeTransaction(transactionId, existingTransaction, requestBody, response);
    }
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

function editReconciliationDetails(transactionId, requestBody, response) {
  const { error, details } = validateTransactionDetails(requestBody);
  if (error) return response.status(400).json({ error });
  const { error: tagError, tagSelection } = validateTransactionTags(requestBody);
  if (tagError) return response.status(400).json({ error: tagError });
  db.transaction(() => {
    db.prepare(`UPDATE transactions SET date = ?, category_id = ?, description = ? WHERE id = ?`)
      .run(details.date, details.categoryId, details.description, transactionId);
    saveTagsOfTransaction(transactionId, tagSelection);
  })();
  response.json({ message: "Transaction updated", id: transactionId });
}

function editWholeTransaction(transactionId, existingTransaction, requestBody, response) {
  if (requestBody.type === "adjustment") return response.status(400).json({ error: "a transaction can't become a reconciliation adjustment" });
  const accountIdsAlreadyUsed = [existingTransaction.from_account_id, existingTransaction.to_account_id];
  const { error, transaction } = validateTransaction(requestBody, accountIdsAlreadyUsed);
  if (error) return response.status(400).json({ error });
  const { error: tagError, tagSelection } = validateTransactionTags(requestBody);
  if (tagError) return response.status(400).json({ error: tagError });
  db.transaction(() => {
    db.prepare(`
      UPDATE transactions
      SET from_account_id = ?, to_account_id = ?, type = ?, amount = ?, category_id = ?, description = ?, date = ?
      WHERE id = ?
    `).run(transaction.fromAccountId, transaction.toAccountId, transaction.type, transaction.amount,
           transaction.categoryId, transaction.description, transaction.date, transactionId);
    saveTagsOfTransaction(transactionId, tagSelection);
  })();
  response.json({ message: "Transaction updated", id: transactionId });
}

// Delete a transaction. The delete trigger puts the money back on its accounts; its tag links go too (ON DELETE CASCADE).
router.delete("/transactions/:id", function deleteTransaction(request, response) {
  const transactionId = Number(request.params.id);
  const existingTransaction = selectTransactionById.get(transactionId);
  if (!existingTransaction) return response.status(404).json({ error: "Transaction not found" });
  if (existingTransaction.type === "investment") return response.status(400).json({ error: INVESTMENT_TRANSACTION_IS_LOCKED });
  db.prepare(`DELETE FROM transactions WHERE id = ?`).run(transactionId);
  response.json({ message: "Transaction deleted" });
});

module.exports = router;
