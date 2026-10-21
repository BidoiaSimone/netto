// ---- new transactions kept on this device while the server can't be reached ----
// Adding a transaction on the phone while the Mac sleeps: the transaction dialog hands it here instead of failing.
// It's kept in this browser (localStorage) and sent as soon as the server answers again (sendPendingTransactions,
// called before every reload of the data and every half minute by JS/app/offlineStatus.js).
//
// Each one gets an offline_id made up here. If a send is cut off after the server saved it but before the answer
// arrived, it's sent again on the next try, and the server recognises the id and doesn't add it twice
// (migration 18). A transaction the server refuses (an account deleted meanwhile...) stays here with the reason,
// so it's never lost silently: delete it, or add it again by hand.

import { callApi } from "./apiClient.js";
import { isServerReachable } from "./connectionState.js";
import { listPendingChanges, writePendingChanges } from "./pendingChanges.js";

const STORAGE_KEY = "netto.pendingTransactions";
const SEND_TIMEOUT_MILLISECONDS = 8000;

// [{ offline_id, transaction (as POST /transactions takes it), kept_at, refused_because }]
function readPending() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; } catch { return []; }
}
function writePending(pending) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pending)); // throws if storage is full or off: the caller says so
  window.dispatchEvent(new CustomEvent("netto:pending"));
}

export const listPendingTransactions = () => readPending();

// Every new transaction from the dialog gets one before its first try: if that try times out after the server
// saved it, the copy sent later carries the same id and isn't added twice
export const makeOfflineId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// The date is fixed now: sent tomorrow, "today" would otherwise become tomorrow
export function keepTransactionForLater(transaction, today, offlineId = makeOfflineId()) {
  const pending = readPending();
  pending.push({ offline_id: offlineId, transaction: { ...transaction, date: transaction.date || today }, kept_at: new Date().toISOString(), refused_because: null });
  writePending(pending);
}

export function forgetPendingTransaction(offlineId) {
  writePending(readPending().filter((item) => item.offline_id !== offlineId));
}

let isSending = false;

// Sends them in the order they were made. Stops at the first one that can't reach the server (the rest would fail
// too); one the server refuses is marked and skipped. Returns how many were added.
export async function sendPendingTransactions() {
  if (isSending || !readPending().some((item) => !item.refused_because)) return 0;
  isSending = true;
  let sentCount = 0;
  try {
    for (const item of readPending()) {
      if (item.refused_because) continue;
      try {
        await callApi("/transactions", { method: "POST", body: { ...item.transaction, offline_id: item.offline_id }, timeoutMilliseconds: SEND_TIMEOUT_MILLISECONDS });
      } catch (error) {
        if (error.isServerUnreachable) break;
        writePending(readPending().map((other) => (other.offline_id === item.offline_id ? { ...other, refused_because: error.message } : other)));
        continue;
      }
      writePending(readPending().filter((other) => other.offline_id !== item.offline_id));
      sentCount++;
    }
  } finally {
    isSending = false;
  }
  return sentCount;
}

// The edits and deletions kept meanwhile (core/pendingChanges.js), after the new transactions, in their order.
// A deletion of something already gone counts as done; a change the server refuses is marked and skipped.
let isSendingChanges = false;
export async function sendPendingChanges() {
  if (isSendingChanges || !listPendingChanges().some((change) => !change.refused_because)) return 0;
  isSendingChanges = true;
  let sentCount = 0;
  try {
    for (const change of listPendingChanges()) {
      if (change.refused_because) continue;
      try {
        await callApi(change.path, { method: change.method, body: change.body ?? undefined, timeoutMilliseconds: SEND_TIMEOUT_MILLISECONDS, keepIfUnreachable: false });
      } catch (error) {
        if (error.isServerUnreachable) break;
        if (!(change.method === "DELETE" && error.status === 404)) {
          writePendingChanges(listPendingChanges().map((other) => (other.change_id === change.change_id ? { ...other, refused_because: error.message } : other)));
          continue;
        }
      }
      writePendingChanges(listPendingChanges().filter((other) => other.change_id !== change.change_id));
      sentCount++;
    }
  } finally {
    isSendingChanges = false;
  }
  return sentCount;
}

// How long a new transaction waits for the server before it's kept on this device instead
const ADD_TIMEOUT_MILLISECONDS = 8000;

// ---------- the same transaction twice in a row ----------
// One-tap buttons and a slow connection make it easy to add the same coffee twice. Each new transaction is
// remembered for a couple of minutes (this tab: sessionStorage); the exact same one again within that time asks first.
const RECENT_KEY = "netto.recentlyAdded";
const DUPLICATE_WINDOW_MILLISECONDS = 2 * 60 * 1000;
const sameTransactionKey = (transaction, today) => JSON.stringify([transaction.type, transaction.amount, transaction.from_account_id ?? null,
  transaction.to_account_id ?? null, transaction.category_id ?? null, (transaction.description ?? "").trim().toLowerCase(), transaction.date || today]);
function readRecentlyAdded() {
  try { return (JSON.parse(sessionStorage.getItem(RECENT_KEY)) ?? []).filter((item) => Date.now() - item.at < DUPLICATE_WINDOW_MILLISECONDS); } catch { return []; }
}
function rememberAdded(transaction, today) {
  try { sessionStorage.setItem(RECENT_KEY, JSON.stringify([...readRecentlyAdded(), { key: sameTransactionKey(transaction, today), at: Date.now() }])); } catch {}
}
// Seconds since the same transaction was added, or null
function secondsSinceSameOne(transaction, today) {
  const key = sameTransactionKey(transaction, today);
  const same = readRecentlyAdded().filter((item) => item.key === key).at(-1);
  return same ? Math.round((Date.now() - same.at) / 1000) : null;
}

// Adds a new transaction now, or, with the server out of reach, keeps it on this device to send later.
// Used by the transaction dialog and the quick-add buttons on Home.
// Returns { added: true, id }, { kept: true, offlineId }, or { cancelled: true } when it's the same as one added a
// moment ago and you said no. Throws the server's error when it refuses the transaction (fix it and try again),
// or when it can't be reached AND this device can't keep it either.
export async function addTransactionNowOrLater(transaction, today) {
  const secondsAgo = secondsSinceSameOne(transaction, today);
  if (secondsAgo !== null) {
    const what = `${transaction.description || "this"} (${Number(transaction.amount).toFixed(2).replace(".", ",")} €)`;
    if (!confirm(`You added ${what} ${secondsAgo < 60 ? `${secondsAgo} seconds` : "a minute"} ago. Add it again?`)) return { cancelled: true };
  }
  const offlineId = makeOfflineId(); // the same id now and on a later send: added only once
  try {
    if (!isServerReachable()) throw Object.assign(new Error("offline"), { isServerUnreachable: true });
    const { id } = await callApi("/transactions", { method: "POST", body: { ...transaction, offline_id: offlineId }, timeoutMilliseconds: ADD_TIMEOUT_MILLISECONDS });
    rememberAdded(transaction, today);
    return { added: true, id };
  } catch (error) {
    if (!error.isServerUnreachable) throw error;
    try {
      keepTransactionForLater(transaction, today, offlineId);
    } catch (storageError) {
      throw new Error(`The server can't be reached, and this device couldn't keep it either: ${storageError.message}`);
    }
    rememberAdded(transaction, today);
    return { kept: true, offlineId };
  }
}
