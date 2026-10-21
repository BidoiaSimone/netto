// ---- reloading everything from the server ----
// After any change (and on auto refresh) every page reloads its data, so they never disagree.

import { showErrorMessage } from "./errorBanner.js";
import { isServerReachable } from "./connectionState.js";
import { sendPendingTransactions, listPendingTransactions, sendPendingChanges } from "./offlineQueue.js";
import { listPendingChanges } from "./pendingChanges.js";
import { loadNetWorth } from "../pages/homePage.js";
import { loadAccounts } from "../pages/assetsPage.js";
import { loadTransactions } from "../pages/transactionsPage.js";
import { loadCategories } from "../pages/categoriesPage.js";
import { loadTags } from "../pages/tagManagement.js";
import { loadBudgetProgress } from "../pages/budgetProgress.js";
import { loadForecast } from "../pages/forecastPage.js";
import { loadInvestments } from "../pages/investmentsPage.js";
import { loadNetWorthHistory } from "../pages/netWorthHistoryChart.js";
import { loadRecurringTransactions } from "../pages/recurringPage.js";
import { loadBackupStatus } from "../settings/backupSettings.js";
import { loadStatements } from "../pages/statementsPage.js";
import { loadYearInReview } from "../pages/yearInReviewPage.js";
import { loadTargetAllocation } from "../pages/targetAllocation.js";
import { loadAppSettings } from "./appSettings.js";
import { loadCategoryTrends } from "../pages/categoryTrends.js";
import { loadReconciliationReminders } from "../pages/reconciliationReminders.js";
import { loadMonthlyExpenses } from "../pages/liquidityInsights.js";
import { loadSavingsGoals } from "../pages/goalsPage.js";
import { loadMonthWrapUp, loadWrapUpMonths } from "../pages/monthWrapUp.js";
import { renderReminderSettings } from "../settings/reminderSettings.js";
import { isLightEdition } from "./edition.js";

// Every page of the full app
function loadersOfTheFullApp() {
  return [
    loadNetWorth(),
    loadAccounts().then(loadTransactions).then(loadSavingsGoals), // transactions show account names; goals offer them as purchases
    loadCategories(),
    loadTags(),
    loadBudgetProgress(),
    loadForecast(),
    loadRecurringTransactions(),
    loadInvestments(),
    loadMonthlyExpenses(), // the emergency fund on Insights
    loadMonthWrapUp(),     // Home, from the 1st of the month until closed
    loadWrapUpMonths(),    // Settings > Month wrap-ups
    // the settings first: the target allocation, the trends and the reminders all use them
    loadAppSettings().then(() => {
      renderReminderSettings();
      return Promise.all([loadTargetAllocation(), loadCategoryTrends(), loadReconciliationReminders()]).then((warnings) => warnings.filter(Boolean).join(" · "));
    }),
    loadNetWorthHistory(),
    loadBackupStatus(),
    loadStatements(),
    loadYearInReview(),
  ];
}

// netto light (core/edition.js): only what its pages show. No goals, budgets, forecast, liquidity, trends, target
// allocation, reminders, statements or year in review; the month wrap-up only in Settings, not on Home.
function loadersOfTheLightEdition() {
  return [
    loadNetWorth(),
    loadAccounts().then(loadTransactions),
    loadCategories(),
    loadTags(),
    loadRecurringTransactions(),
    loadInvestments(),
    loadWrapUpMonths(),    // Settings > Month wrap-ups
    loadNetWorthHistory(),
    loadBackupStatus(),
  ];
}

// Each loader may return a warning to show (e.g. a ticker without a live price) or throw an error.
// All of them run even if one fails; the messages are shown together in the error line.
export async function loadAllData() {
  const results = await Promise.allSettled(isLightEdition ? loadersOfTheLightEdition() : loadersOfTheFullApp());
  // with the server unreachable, the pages show the copies the service worker saved: the line at the top says so,
  // and the red line keeps only the real errors (the "can't reach" ones are for what was never saved)
  const messages = results.filter((result) => !(result.status === "rejected" && result.reason.isServerUnreachable && !isServerReachable()))
    .map((result) => (result.status === "rejected" ? result.reason.message : result.value)).filter(Boolean);
  showErrorMessage(messages.join(" · "));

  // the server answers again: send what was kept on this device meanwhile, then show the data with it
  const somethingWaiting = [...listPendingTransactions(), ...listPendingChanges()].some((item) => !item.refused_because);
  if (isServerReachable() && somethingWaiting) {
    const sentCount = (await sendPendingTransactions()) + (await sendPendingChanges()); // new ones first, then the edits
    if (sentCount) await loadAllData();
  }
}

// Runs a change (usually an API call), then reloads everything. Errors go to the error line.
export async function runThenReloadAllData(action) {
  try {
    await action();
    await loadAllData();
  } catch (error) {
    showErrorMessage(error.message);
  }
}
