// ---- the line at the top of every page when the server can't be reached, and what waits to be sent ----
//   [● Offline]  a button: tapping it tries to reach the Mac again (on phones it's the badge in the top bar instead)
//   "1 new transaction and 2 changes kept on this device · 3 waiting to be sent  [Send now]"  + one row each (with ✕)
// While something is wrong it checks again every half minute (a reload of the data, which also sends what's waiting:
// core/dataRefresh.js), and right away when the device comes back online or the app is brought to the front.

import { elementById, createElement } from "../core/domHelpers.js";
import { visibleEuroFormatter, formatShortDate } from "../core/formatting.js";
import { appState } from "../core/appState.js";
import { isServerReachable, askServiceWorkerToRetry } from "../core/connectionState.js";
import { listPendingTransactions, forgetPendingTransaction } from "../core/offlineQueue.js";
import { listPendingChanges, forgetPendingChange } from "../core/pendingChanges.js";
import { loadAllData } from "../core/dataRefresh.js";
import { renderTodaySpending } from "../pages/quickAdd.js";
import { t, tp } from "../core/i18n.js";

const CHECK_AGAIN_EVERY_MILLISECONDS = 30000;
let isTrying = false; // a "try again" is under way

const accountName = (id) => appState.accounts.find((account) => account.id === id)?.name ?? "?";
const categoryName = (id) => appState.categories.find((category) => category.id === id)?.name;

// "15 ott · −3,50 € · Coffee · Cash"
function describePending({ transaction }) {
  const sign = transaction.type === "expense" ? "−" : transaction.type === "income" ? "+" : "";
  const accounts = transaction.type === "movement"
    ? `${accountName(transaction.from_account_id)} → ${accountName(transaction.to_account_id)}`
    : accountName(transaction.from_account_id ?? transaction.to_account_id);
  return [formatShortDate(transaction.date), sign + visibleEuroFormatter.format(transaction.amount),
    transaction.description || categoryName(transaction.category_id) || t(transaction.type), accounts].join(" · ");
}

function createPendingRow(item) {
  const row = createElement("li", item.refused_because ? "refused" : "");
  row.append(createElement("span", "", describePending(item)));
  if (item.refused_because) row.append(createElement("small", "neg", " " + t("refused by the server: {reason}", { reason: item.refused_because })));
  const removeButton = createElement("button", "ghost", "✕");
  removeButton.type = "button";
  removeButton.title = t("Delete it from this device (it was never added)");
  removeButton.addEventListener("click", () => {
    if (confirm(t("Delete \"{name}\"? It hasn't been added to netto, so it will be gone.", { name: describePending(item) }))) forgetPendingTransaction(item.offline_id);
  });
  row.append(removeButton);
  return row;
}

// An edit or deletion waiting: "Delete Coffee −0,60 € (15 ott)  ✕" (✕: don't send it)
function createChangeRow(change) {
  const row = createElement("li", change.refused_because ? "refused" : "");
  row.append(createElement("span", "", change.label));
  if (change.refused_because) row.append(createElement("small", "neg", " " + t("refused by the server: {reason}", { reason: change.refused_because })));
  const removeButton = createElement("button", "ghost", "✕");
  removeButton.type = "button";
  removeButton.title = t("Don't send it: the Mac keeps it as it was");
  removeButton.addEventListener("click", () => {
    if (confirm(t("Don't send \"{name}\"? On your Mac it stays as it was.", { name: change.label }))) { forgetPendingChange(change.change_id); loadAllData(); }
  });
  row.append(removeButton);
  return row;
}

// Phones: a small badge in the top bar, visible from anywhere on the page: "offline" when the Mac can't be reached
// (tap: try again), "↑ 2" waiting to be sent (tap: send now and scroll up to the list).
function renderPhoneBadge(pending, isReachable) {
  const badge = elementById("phone-pending-badge");
  const waitingCount = pending.filter((item) => !item.refused_because).length;
  const refusedCount = pending.length - waitingCount;
  badge.hidden = isReachable && !pending.length;
  badge.classList.toggle("refused", refusedCount > 0);
  badge.textContent = refusedCount ? `! ${refusedCount}` : waitingCount ? `↑ ${waitingCount}` : isTrying ? "…" : t("offline");
  badge.title = refusedCount ? t("Something kept on this device was refused: see the top of the page")
    : waitingCount ? t("{count} waiting to be sent", { count: waitingCount }) : t("Your Mac can't be reached: tap to try again");
}

export function renderOfflineStatus() {
  const bar = elementById("offline-bar");
  const changes = listPendingChanges();
  const pending = [...listPendingTransactions(), ...changes]; // the badge counts both
  const isReachable = isServerReachable();
  renderPhoneBadge(pending, isReachable);
  renderTodaySpending(); // today's total counts the ones waiting here too
  bar.hidden = isReachable && !pending.length;
  if (bar.hidden) return bar.replaceChildren();

  const parts = [];
  bar.classList.toggle("only-offline", !isReachable && !pending.length); // phones: the top bar's badge says it already
  if (!isReachable) parts.push(createOfflineButton());
  if (pending.length) {
    const newOnes = listPendingTransactions();
    const waitingCount = pending.filter((item) => !item.refused_because).length;
    const head = createElement("p", "offline-line");
    const what = [newOnes.length && tp(newOnes.length, "{count} new transaction", "{count} new transactions"),
      changes.length && tp(changes.length, "{count} change", "{count} changes")].filter(Boolean).join(t(" and "));
    head.append(createElement("strong", "", t("{what} kept on this device", { what })),
      waitingCount ? ` · ${t("{count} waiting to be sent", { count: waitingCount })} ` : " ");
    if (waitingCount) {
      const sendButton = createElement("button", "ghost", t("Send now"));
      sendButton.type = "button";
      sendButton.addEventListener("click", tryAgainNow);
      head.append(sendButton);
    }
    const list = createElement("ul", "pending-list");
    list.append(...newOnes.map(createPendingRow), ...changes.map(createChangeRow));
    parts.push(head, list);
  }
  bar.replaceChildren(...parts);
}

// "● Offline": tap to try reaching the Mac again
function createOfflineButton() {
  const button = createElement("button", "offline-pill", isTrying ? t("Connecting…") : t("Offline"));
  button.type = "button";
  button.title = t("Your Mac can't be reached: tap to try again");
  button.disabled = isTrying;
  button.addEventListener("click", tryAgainNow);
  return button;
}

async function tryAgainNow() {
  if (isTrying) return;
  isTrying = true;
  renderOfflineStatus();
  askServiceWorkerToRetry();
  try { await loadAllData(); } finally { isTrying = false; renderOfflineStatus(); }
}

function checkAgainIfSomethingIsWaiting() {
  const somethingWaiting = [...listPendingTransactions(), ...listPendingChanges()].some((item) => !item.refused_because);
  if (!isServerReachable() || somethingWaiting) tryAgainNow();
}

export function initializeOfflineStatus() {
  window.addEventListener("netto:connection", renderOfflineStatus);
  window.addEventListener("netto:pending", renderOfflineStatus);
  elementById("phone-pending-badge").addEventListener("click", () => {
    if (listPendingTransactions().length || listPendingChanges().length) window.scrollTo({ top: 0, behavior: "smooth" });
    tryAgainNow();
  });
  window.addEventListener("online", checkAgainIfSomethingIsWaiting);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkAgainIfSomethingIsWaiting(); });
  setInterval(checkAgainIfSomethingIsWaiting, CHECK_AGAIN_EVERY_MILLISECONDS);
  renderOfflineStatus();
}
