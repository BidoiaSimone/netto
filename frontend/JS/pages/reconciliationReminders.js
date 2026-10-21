// ---- reconciliation reminders: accounts due to be counted again (GET /reconciliation-reminders) ----
// Shown as a short line of buttons on Home and as a list on Next up. Each button opens the quick reconcile
// dialog for that account (dialogs/quickReconcileDialog.js). How often each kind of account is due is a setting
// (Settings > Reminders); the rule itself is in backend/server/services/reconciliationReminders.js.

import { elementById, createElement } from "../core/domHelpers.js";
import { formatCount } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { openQuickReconcileDialog } from "../dialogs/quickReconcileDialog.js";

export async function loadReconciliationReminders() {
  appState.reconciliationReminders = await callApi("/reconciliation-reminders");
  renderReconciliationReminders();
}

// "never counted", "35 days ago"
const describeLastCount = (reminder) => (reminder.days_since === null ? "never counted" : `${formatCount(reminder.days_since, "day")} ago`);

function createReminderButton(reminder, className) {
  const button = createElement("button", className);
  button.type = "button";
  button.append(createElement("strong", "", reminder.name), createElement("span", "reminder-when", describeLastCount(reminder)));
  button.title = `Due every ${reminder.every_days} days: count it now`;
  button.addEventListener("click", () => openQuickReconcileDialog(reminder));
  return button;
}

function renderReconciliationReminders() {
  const reminders = appState.reconciliationReminders;

  // Home: one compact line, only when something is due
  const homeBox = elementById("home-reminders");
  homeBox.hidden = reminders.length === 0;
  homeBox.replaceChildren(
    createElement("span", "reminder-badge", `${reminders.length} to reconcile`),
    ...reminders.map((reminder) => createReminderButton(reminder, "ghost reminder-chip")),
  );

  // Next up: the same accounts as a list, with how overdue each one is
  const nextUpList = elementById("nextup-reminders");
  elementById("nextup-reminders-title").hidden = reminders.length === 0;
  nextUpList.replaceChildren(...reminders.map((reminder) => {
    const listItem = createElement("li", "reminder-item");
    const overdueText = reminder.overdue_days === null ? "never counted" : reminder.overdue_days === 0 ? "due today" : `${formatCount(reminder.overdue_days, "day")} overdue`;
    listItem.append(
      createElement("span", "reminder-text", `Reconcile ${reminder.name}`),
      createElement("span", "reminder-when", `${overdueText} · every ${reminder.every_days} days`),
      createReminderButton(reminder, "ghost reminder-open"),
    );
    listItem.lastChild.replaceChildren("Count now");
    return listItem;
  }));
}
