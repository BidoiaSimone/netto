// ---- Home > quick add: your most frequent transactions as one-tap buttons ----
// The expenses and incomes you've added most often in the last QUICK_ADD_DAYS days (same type, category, account,
// amount and description, at least twice) become buttons: "Coffee 0,60 € · Cash". A tap adds that transaction again,
// dated today, through the same path as the dialog: with the server out of reach it's kept on this device and sent
// later (core/offlineQueue.js). A line at the bottom then offers Undo, and Change (opens it to fix the amount...).
// Recurring ones are left out (they add themselves), and so are ones in another currency or on a closed account.

import { elementById, createElement } from "../core/domHelpers.js";
import { visibleEuroFormatter, getTodayAsLocalDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState, isAccountOpen } from "../core/appState.js";
import { loadAllData } from "../core/dataRefresh.js";
import { addTransactionNowOrLater, forgetPendingTransaction, listPendingTransactions } from "../core/offlineQueue.js";
import { openTransactionEditor } from "../dialogs/transactionDialog.js";
import { showToast } from "../core/toast.js";
import { createTransactionIcon } from "../core/transactionDisplay.js";

const QUICK_ADD_DAYS = 90;
const NUMBER_OF_BUTTONS = 6;

// The transactions that repeat, most frequent first: [{ transaction (as POST takes it), count, label }]
export function findFrequentTransactions(transactions, today, accounts) {
  const since = new Date(Date.parse(today) - QUICK_ADD_DAYS * 864e5).toISOString().slice(0, 10);
  const openAccountIds = new Set(accounts.filter(isAccountOpen).map((account) => account.id));
  const groups = new Map();
  for (const transaction of transactions) { // newest first, so each group keeps its newest one
    if (!["expense", "income"].includes(transaction.type) || transaction.recurring_transaction_id || transaction.original_currency) continue;
    if (transaction.date < since) continue;
    const accountId = transaction.type === "expense" ? transaction.from_account_id : transaction.to_account_id;
    if (!openAccountIds.has(accountId)) continue;
    const description = (transaction.description ?? "").trim();
    const key = [transaction.type, transaction.category_id, accountId, transaction.amount, description.toLowerCase()].join("|");
    if (!groups.has(key)) groups.set(key, { newest: transaction, description, accountId, count: 0 });
    groups.get(key).count++;
  }
  return [...groups.values()]
    .filter((group) => group.count >= 2)
    .sort((first, second) => second.count - first.count || (first.newest.date < second.newest.date ? 1 : -1))
    .slice(0, NUMBER_OF_BUTTONS)
    .map(({ newest, description, accountId, count }) => ({
      count,
      name: description || newest.category || newest.type,
      account: newest.type === "expense" ? newest.from_account : newest.to_account,
      transaction: {
        type: newest.type, amount: newest.amount, category_id: newest.category_id, description: description || null,
        from_account_id: newest.type === "expense" ? accountId : null, to_account_id: newest.type === "income" ? accountId : null,
      },
    }));
}

// ---------- the buttons ----------

async function addAgain(frequent, button) {
  button.disabled = true;
  const sign = frequent.transaction.type === "expense" ? "−" : "+";
  const what = `${frequent.name} ${sign}${visibleEuroFormatter.format(frequent.transaction.amount)}`;
  let result;
  try {
    result = await addTransactionNowOrLater(frequent.transaction, getTodayAsLocalDate());
  } catch (error) {
    showToast(`Not added: ${error.message}`, []);
    button.disabled = false;
    return;
  }
  button.disabled = false;
  if (result.cancelled) return; // the same one a moment ago, and you said no
  if (result.kept) {
    showToast(`${what}: kept on this device, sent when your Mac is back`, [{ label: "Undo", onClick: () => forgetPendingTransaction(result.offlineId) }]);
    return loadAllData();
  }
  showToast(`${what} added`, [
    { label: "Undo", onClick: () => callApi(`/transactions/${result.id}`, { method: "DELETE" }).then(loadAllData).catch((error) => showToast(error.message, [])) },
    { label: "Change", onClick: () => { const added = appState.transactions.find((transaction) => transaction.id === result.id); if (added) openTransactionEditor(added); } },
  ]);
  await loadAllData();
}

// ---------- "Today: 5,90 € spent" ----------
// Under the buttons: what you've spent today, the ones still waiting on this device included. A quick check that
// today's coffee is in; "Nothing added today yet" is the gentle nudge.
export function renderTodaySpending() {
  const today = getTodayAsLocalDate();
  const expensesToday = [
    ...appState.transactions.filter((transaction) => transaction.type === "expense" && transaction.date === today),
    ...listPendingTransactions().map((item) => item.transaction).filter((transaction) => transaction.type === "expense" && transaction.date === today),
  ];
  const line = elementById("today-spent");
  if (!expensesToday.length) {
    line.textContent = "Nothing added today yet";
    return;
  }
  const total = expensesToday.reduce((sum, transaction) => sum + transaction.amount, 0);
  line.replaceChildren("Today: ", createElement("strong", "", visibleEuroFormatter.format(total)),
    ` spent · ${expensesToday.length} expense${expensesToday.length === 1 ? "" : "s"}`);
}

export function renderQuickAdd() {
  renderTodaySpending();
  const frequentTransactions = findFrequentTransactions(appState.transactions, getTodayAsLocalDate(), appState.accounts);
  const container = elementById("quick-add");
  container.hidden = !frequentTransactions.length;
  container.replaceChildren(...frequentTransactions.map((frequent) => {
    const button = createElement("button", `quick-add-button ${frequent.transaction.type}`);
    button.type = "button";
    button.title = `Add it again, dated today (added ${frequent.count} times in the last ${QUICK_ADD_DAYS} days)`;
    const sign = frequent.transaction.type === "expense" ? "−" : "+";
    const icon = createTransactionIcon(frequent.transaction); // Pocket only (32-quick-add.css)
    icon.className = `category-icon small quick-add-icon${icon.classList.contains("uncategorized") ? " uncategorized" : ""}`;
    button.append(icon, createElement("strong", "", frequent.name), createElement("span", "quick-add-amount", `${sign}${visibleEuroFormatter.format(frequent.transaction.amount)}`),
      createElement("small", "", frequent.account ?? ""));
    button.addEventListener("click", () => addAgain(frequent, button));
    return button;
  }));
}
