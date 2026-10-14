// ---- reloading everything from the server ----
// After any change (and on auto refresh) every page reloads its data, so they never disagree.

import { showErrorMessage } from "./errorBanner.js";
import { loadNetWorth } from "../pages/homePage.js";
import { loadAccounts } from "../pages/assetsPage.js";
import { loadTransactions } from "../pages/transactionsPage.js";
import { loadCategories } from "../pages/categoriesPage.js";
import { loadInvestments } from "../pages/investmentsPage.js";
import { loadNetWorthHistory } from "../pages/netWorthHistoryChart.js";
import { loadRecurringTransactions } from "../pages/recurringPage.js";
import { loadBackupStatus } from "../settings/backupSettings.js";
import { loadStatements } from "../pages/statementsPage.js";

// Each loader may return a warning to show (e.g. a ticker without a live price) or throw an error.
// All of them run even if one fails; the messages are shown together in the error line.
export async function loadAllData() {
  const results = await Promise.allSettled([
    loadNetWorth(),
    loadAccounts().then(loadTransactions), // transactions show account names
    loadCategories(),
    loadRecurringTransactions(),
    loadInvestments(),
    loadNetWorthHistory(),
    loadBackupStatus(),
    loadStatements(),
  ]);
  const messages = results.map((result) => (result.status === "rejected" ? result.reason.message : result.value)).filter(Boolean);
  showErrorMessage(messages.join(" · "));
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
