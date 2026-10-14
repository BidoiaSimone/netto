// ---- how a transaction's amount is shown (Home and Transactions pages) ----

import { createElement } from "./domHelpers.js";
import { euroFormatter } from "./formatting.js";

// +1 money in, -1 money out, 0 a movement between your own accounts
function getMoneyDirection(transaction) {
  if (transaction.type === "income") return 1;
  if (transaction.type === "adjustment") return transaction.to_account ? 1 : -1;
  if (transaction.type === "expense") return -1;
  if (transaction.type === "investment") return transaction.to_account ? 1 : -1;
  return 0;
}

// The description, with a ↻ when a recurring transaction added it
export function createDescriptionCell(transaction) {
  const cell = createElement("span", "", transaction.description ?? "");
  if (transaction.recurring_transaction_id) {
    const marker = createElement("span", "recurring-marker", "↻");
    marker.title = "Added by a recurring transaction";
    cell.prepend(marker);
  }
  return cell;
}

// Green for money in, red for money out, plain for movements.
// Investment trades show their direction (+ sold, − bought) but no colour: money changing form, not income or spending.
export function createSignedAmountCell(transaction) {
  const direction = getMoneyDirection(transaction);
  const colourClass = transaction.type === "investment" ? "" : direction > 0 ? "pos" : direction < 0 ? "neg" : "";
  const sign = direction > 0 ? "+" : direction < 0 ? "−" : "";
  return createElement("span", colourClass, sign + euroFormatter.format(transaction.amount));
}
