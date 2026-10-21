// ---- Settings > Reminders and highlights: the settings stored with your data (PUT /settings) ----
// How often accounts are due to be reconciled, and when a category counts as "running hot" on Insights.
// Each field saves as soon as you leave it (or press Enter); a value out of range is put back with the reason.

import { elementById } from "../core/domHelpers.js";
import { bindNumberInputToSetting } from "../core/appSettings.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { loadCategoryTrends } from "../pages/categoryTrends.js";
import { loadReconciliationReminders } from "../pages/reconciliationReminders.js";

const reloadTrends = () => loadCategoryTrends().catch((error) => showErrorMessage(error.message));
const reloadReminders = () => loadReconciliationReminders().catch((error) => showErrorMessage(error.message));

export function renderReminderSettings() {
  bindNumberInputToSetting(elementById("setting-reconcile-everyday"), "reconcile_every_days_everyday", { onSaved: reloadReminders, showError: showErrorMessage });
  bindNumberInputToSetting(elementById("setting-reconcile-savings"), "reconcile_every_days_savings", { onSaved: reloadReminders, showError: showErrorMessage });
  // stored as a share (0.25), typed as a percentage (25)
  bindNumberInputToSetting(elementById("setting-trend-share"), "trend_highlight_share", {
    onSaved: reloadTrends, showError: showErrorMessage,
    toDisplay: (share) => Math.round(share * 100), fromDisplay: (percent) => percent / 100,
  });
  bindNumberInputToSetting(elementById("setting-trend-euros"), "trend_highlight_minimum_euros", { onSaved: reloadTrends, showError: showErrorMessage });
}
