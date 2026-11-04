// ---- account kinds and liquidity classes (same list as backend/config/accountKinds.js: change both together) ----
// Each account kind belongs to a liquidity class: how quickly, and how surely, it can become money you spend.
// The investments are a class of their own, filled from the Investments page instead of from accounts.

import { t } from "./i18n.js";

export const ACCOUNT_KINDS = {
  cash: { label: t("Cash"), liquidity: "cash_and_equivalents" },
  bank: { label: t("Current account"), liquidity: "cash_and_equivalents" },
  savings: { label: t("Savings account"), liquidity: "cash_and_equivalents" },
  restricted: { label: t("Restricted (vouchers)"), liquidity: "restricted" },
  asset: { label: t("Personal-use asset"), liquidity: "personal_use" },
};

// From most to least liquid, as on a personal balance sheet
export const LIQUIDITY_CLASSES = [
  { key: "cash_and_equivalents", label: t("Cash & cash equivalents"), howLiquid: t("spendable today, at exactly this value") },
  { key: "restricted", label: t("Restricted cash"), howLiquid: t("real money, but only for some purchases") },
  { key: "investments", label: t("Investments"), howLiquid: t("a few days to sell, at that day's price") },
  { key: "personal_use", label: t("Personal-use assets"), howLiquid: t("money only once sold; the value is your estimate") },
];

// "Current account"; an unknown kind is shown as it is
export const getAccountKindLabel = (kind) => ACCOUNT_KINDS[kind]?.label ?? kind;
