// ---- changes kept on this device while the server can't be reached: edits and deletions ----
// New transactions have their own queue (core/offlineQueue.js, which also sends these). Every other change the app
// makes with PUT or DELETE (editing or deleting a transaction, a budget, a goal, a category's name…) is kept here
// when the Mac can't be reached (core/apiClient.js does it by itself), and sent later in the same order.
// Creating other things (an account, a goal, a trade…) still needs the Mac: those can't be told apart if sent twice.
//
// While they wait, the transactions list already shows them: a deleted transaction is gone, an edited one shows its
// new values (applyPendingTransactionChanges). Balances and totals follow once the Mac has them.
// Sending a change twice is harmless (the same values again; a deletion of something already gone is fine).

import { appState } from "./appState.js";
import { visibleEuroFormatter } from "./formatting.js";

const STORAGE_KEY = "netto.pendingChanges";

// [{ change_id, method, path, body, label, kept_at, refused_because }]
export function listPendingChanges() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; } catch { return []; }
}
export function writePendingChanges(changes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(changes)); // throws if storage is full or off: the caller says so
  window.dispatchEvent(new CustomEvent("netto:pending"));
}

// "Delete Coffee −0,60 € (15 ott)", "Change Food −12,10 € (16 ott)", "Change: savings-goals/1"
function describeChange(method, path, body) {
  const transactionMatch = path.match(/^\/transactions\/(\d+)$/);
  const verb = method === "DELETE" ? "Delete" : "Change";
  if (transactionMatch) {
    const transaction = appState.transactions.find((candidate) => candidate.id === Number(transactionMatch[1]));
    if (transaction) {
      const name = transaction.description || transaction.category || transaction.type;
      const day = new Date(transaction.date + "T12:00").toLocaleDateString("it-IT", { day: "numeric", month: "short" });
      return `${verb} ${name} ${visibleEuroFormatter.format(transaction.amount)} (${day})${method === "PUT" && body?.amount != null && body.amount !== transaction.amount ? ` → ${visibleEuroFormatter.format(body.amount)}` : ""}`;
    }
  }
  return `${verb}: ${path.replace(/^\//, "").replace(/\//g, " › ")}`;
}

// Keeps a change for later; returns its id. A second change to the same thing replaces the first (only the last
// values matter), and a deletion replaces any change still waiting for it.
export function keepChangeForLater(method, path, body) {
  const changeId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const others = listPendingChanges().filter((change) => !(change.path === path && (method === "DELETE" || change.method === method)));
  others.push({ change_id: changeId, method, path, body: body ?? null, label: describeChange(method, path, body), kept_at: new Date().toISOString(), refused_because: null });
  writePendingChanges(others);
  return changeId;
}

export function forgetPendingChange(changeId) {
  writePendingChanges(listPendingChanges().filter((change) => change.change_id !== changeId));
}

// The transactions list as it will be once the waiting changes are sent
export function applyPendingTransactionChanges(transactions) {
  const changes = listPendingChanges().filter((change) => !change.refused_because && /^\/transactions\/\d+$/.test(change.path));
  if (!changes.length) return transactions;
  const deleted = new Set(changes.filter((change) => change.method === "DELETE").map((change) => Number(change.path.split("/")[2])));
  const editedById = new Map(changes.filter((change) => change.method === "PUT").map((change) => [Number(change.path.split("/")[2]), change.body]));
  return transactions.filter((transaction) => !deleted.has(transaction.id)).map((transaction) => {
    const edit = editedById.get(transaction.id);
    if (!edit) return transaction;
    const category = appState.categories.find((candidate) => candidate.id === edit.category_id);
    return { ...transaction, ...edit, date: edit.date || transaction.date, category: category?.name ?? (edit.category_id ? transaction.category : null),
      tags: transaction.tags, pending_change: true };
  });
}
