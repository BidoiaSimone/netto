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
import { initializeTagManagement } from "./pages/tagManagement.js";
import { initializePriceHistoryChart } from "./pages/investmentPriceHistoryChart.js";
import { initializeNetWorthHistoryChart } from "./pages/netWorthHistoryChart.js";
import { initializeNextUpPage, loadTodos } from "./pages/nextUpPage.js";
import { initializeStatementsPage } from "./pages/statementsPage.js";
import { initializeMoneyFlows } from "./pages/moneyFlows.js";
import { initializeYearInReviewPage } from "./pages/yearInReviewPage.js";
import { initializeForecastPage } from "./pages/forecastPage.js";
import { initializeTargetAllocation } from "./pages/targetAllocation.js";
import { initializeCategoryTrends } from "./pages/categoryTrends.js";
import { initializeQuickReconcileDialog } from "./dialogs/quickReconcileDialog.js";
import { initializeTransactionDialog, updateTransactionFieldsForType } from "./dialogs/transactionDialog.js";
import { initializeAccountDialog } from "./dialogs/accountDialog.js";
import { initializeTradeDialog } from "./dialogs/tradeDialog.js";
import { initializeReconcileDialog } from "./dialogs/reconcileDialog.js";
import { initializeRecurringTransactionDialog } from "./dialogs/recurringTransactionDialog.js";
import { initializeGoalDialog } from "./dialogs/goalDialog.js";
import { initializeCategoryLookDialog } from "./dialogs/categoryLookDialog.js";
import { initializeOfflineStatus } from "./app/offlineStatus.js";
import { initializePhoneMenu } from "./app/phoneMenu.js";
import { initializeSheetPosition } from "./app/sheetPosition.js";
import { initializeWrapUpSettings } from "./pages/monthWrapUp.js";
import { initializePrivacyMode, setPrivacyMode, shouldStartInPrivacyMode } from "./settings/privacyMode.js";
import { initializeThemeAndAccentColor } from "./settings/themeAndAccentColor.js";
import { initializeAutoRefreshButton, restoreSavedAutoRefresh } from "./settings/autoRefresh.js";
import { initializeBackupSettings } from "./settings/backupSettings.js";
import { loadAllData } from "./core/dataRefresh.js";
import { loadCurrencies } from "./core/currencies.js";
import { showErrorMessage } from "./core/errorBanner.js";
import { askServiceWorkerToRetry } from "./core/connectionState.js";
import { initializeDecimalInputs } from "./core/decimalInputs.js";
import { initializePhoneTables } from "./app/phoneTables.js";
import { runsWithoutServer } from "./core/edition.js";

// ---- connect buttons, forms and shortcuts ----
initializeDecimalInputs(); // first: phones get decimal fields that take "12,50"
initializePhoneTables();   // and tables that scroll in their own box
initializePageNavigation();
initializePriceHistoryChart();
initializeNetWorthHistoryChart();
initializeAssetsPage();
initializeCategoriesPage();
initializeTagManagement();
initializeAccountDialog();
initializeTransactionDialog();
initializeTradeDialog();
initializeReconcileDialog();
initializeRecurringTransactionDialog();
initializeGoalDialog();
initializeCategoryLookDialog();
initializeOfflineStatus();
initializeWrapUpSettings();
initializePrivacyMode();
initializeDialogWindows();
initializeSheetPosition();
initializeKeyboardShortcuts();
initializeTransactionsPage();
initializeNextUpPage();
initializeStatementsPage();
initializeMoneyFlows();
initializeYearInReviewPage();
initializeForecastPage();
initializeTargetAllocation();
initializeCategoryTrends();
initializeQuickReconcileDialog();
initializeAutoRefreshButton();
initializeThemeAndAccentColor();
initializeBackupSettings();
if (!runsWithoutServer) connectToServerSession(); // the PWA has no server to tell (core/localApi.js)

// ---- first display ----
setPrivacyMode(shouldStartInPrivacyMode(), { redrawPages: false }); // hidden at launch; see Settings > Hide amounts for reloads
updateTransactionFieldsForType();
restoreSavedAutoRefresh();
showPageFromUrl();
initializePhoneMenu(); // after showPageFromUrl: the bar takes the page's name from the active link
loadTodos().catch((error) => showErrorMessage(error.message));
loadCurrencies().catch((error) => showErrorMessage(error.message)); // the list never changes: once is enough
askServiceWorkerToRetry(); // a (re)load always really tries the Mac, even right after it failed
loadAllData();

// The service worker keeps copies of the pages and data, so netto still opens (and new transactions can be added)
// when the server can't be reached: see serviceWorker.js. Browsers only allow it on https:// (the phone, through
// Tailscale) and on localhost. The PWA has its own, next to its pages (pwa/serviceWorker.js): hence the relative path,
// which is /serviceWorker.js on the server and /netto/serviceWorker.js on GitHub Pages.
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register(new URL("../serviceWorker.js", location.href)).catch((error) => console.warn("Service worker not registered:", error));
}
