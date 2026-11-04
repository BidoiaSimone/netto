// ---- the account dropdowns (transaction, trade and recurring forms, transactions filter) ----

import { elementById, replaceSelectOptions } from "./domHelpers.js";
import { appState, isAccountOpen } from "./appState.js";
import { t } from "./i18n.js";

// Option values are account ids: the API identifies accounts by id, so a rename can't break anything.
// Closed accounts stay in the filter (their history is still there) but can't be picked for new entries.
export function refreshAccountPickers() {
  const openAccountOptions = appState.accounts.filter(isAccountOpen).map((account) => ({ value: account.id, label: account.name }));
  const allAccountOptions = appState.accounts.map((account) => ({ value: account.id, label: isAccountOpen(account) ? account.name : t("{name} (closed)", { name: account.name }) }));
  replaceSelectOptions(elementById("account-select"), allAccountOptions, t("All accounts"));
  replaceSelectOptions(elementById("tx-from"), openAccountOptions, t("— from —"));
  replaceSelectOptions(elementById("tx-to"), openAccountOptions, t("— to —"));
  replaceSelectOptions(elementById("trade-account"), openAccountOptions, t("No account (don't move money)"));
  replaceSelectOptions(elementById("rec-from"), openAccountOptions, t("— from —"));
  replaceSelectOptions(elementById("rec-to"), openAccountOptions, t("— to —"));
}

// A closed account isn't in the pickers; an old transaction or trade that used it still needs it shown
export function addClosedAccountOptionIfMissing(selectElement, accountId) {
  if (accountId == null || [...selectElement.options].some((option) => option.value === String(accountId))) return;
  const account = appState.accounts.find((candidate) => candidate.id === accountId);
  if (account) selectElement.append(new Option(t("{name} (closed)", { name: account.name }), account.id));
}
