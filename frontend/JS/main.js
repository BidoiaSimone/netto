// ---- netto's page: the starting point ----
// Home.html loads only this file (as a module). Each feature lives in its own file and exports an
// initialize...() function that connects its buttons and forms; this file calls them in order,
// then loads the data.
//
//   core/      shared helpers: API calls, page elements, number formats, shared data, reloading
//   app/       the page frame: navigation, dialogs, keyboard shortcuts, connection to the server
//   pages/     one file per page of the sidebar (plus the charts that belong to a page)
//   dialogs/   the add / edit windows
//   charts/    chart drawing that doesn't know which page it's on
//   settings/  the Settings page and the preferences it controls

import { initializePageNavigation, showPageFromUrl } from "./app/pageNavigation.js";
import { initializeDialogWindows } from "./app/dialogWindows.js";
import { initializeKeyboardShortcuts } from "./app/keyboardShortcuts.js";
import { connectToServerSession } from "./app/serverSession.js";
import { initializeAssetsPage } from "./pages/assetsPage.js";
import { initializeTransactionsPage } from "./pages/transactionsPage.js";
import { initializeCategoriesPage } from "./pages/categoriesPage.js";
import { initializePriceHistoryChart } from "./pages/investmentPriceHistoryChart.js";
import { initializeNetWorthHistoryChart } from "./pages/netWorthHistoryChart.js";
import { initializeNextUpPage, loadTodos } from "./pages/nextUpPage.js";
import { initializeStatementsPage } from "./pages/statementsPage.js";
import { initializeTransactionDialog, updateTransactionFieldsForType } from "./dialogs/transactionDialog.js";
import { initializeAccountDialog } from "./dialogs/accountDialog.js";
import { initializeTradeDialog } from "./dialogs/tradeDialog.js";
import { initializeReconcileDialog } from "./dialogs/reconcileDialog.js";
import { initializeRecurringTransactionDialog } from "./dialogs/recurringTransactionDialog.js";
import { initializePrivacyMode, setPrivacyMode, shouldStartInPrivacyMode } from "./settings/privacyMode.js";
import { initializeThemeAndAccentColor } from "./settings/themeAndAccentColor.js";
import { initializeAutoRefreshButton, restoreSavedAutoRefresh } from "./settings/autoRefresh.js";
import { initializeBackupSettings } from "./settings/backupSettings.js";
import { loadAllData } from "./core/dataRefresh.js";
import { showErrorMessage } from "./core/errorBanner.js";

// ---- connect buttons, forms and shortcuts ----
initializePageNavigation();
initializePriceHistoryChart();
initializeNetWorthHistoryChart();
initializeAssetsPage();
initializeCategoriesPage();
initializeAccountDialog();
initializeTransactionDialog();
initializeTradeDialog();
initializeReconcileDialog();
initializeRecurringTransactionDialog();
initializePrivacyMode();
initializeDialogWindows();
initializeKeyboardShortcuts();
initializeTransactionsPage();
initializeNextUpPage();
initializeStatementsPage();
initializeAutoRefreshButton();
initializeThemeAndAccentColor();
initializeBackupSettings();
connectToServerSession();

// ---- first display ----
setPrivacyMode(shouldStartInPrivacyMode()); // hidden at launch; see Settings > Hide amounts for reloads
updateTransactionFieldsForType();
restoreSavedAutoRefresh();
showPageFromUrl();
loadTodos().catch((error) => showErrorMessage(error.message));
loadAllData();
