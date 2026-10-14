// ---- account kinds and liquidity classes (same list as backend/config/accountKinds.js: change both together) ----
// Each account kind belongs to a liquidity class: how quickly, and how surely, it can become money you spend.
// The investments are a class of their own, filled from the Investments page instead of from accounts.

export const ACCOUNT_KINDS = {
  cash: { label: "Cash", liquidity: "cash_and_equivalents" },
  bank: { label: "Current account", liquidity: "cash_and_equivalents" },
  savings: { label: "Savings account", liquidity: "cash_and_equivalents" },
  restricted: { label: "Restricted (vouchers)", liquidity: "restricted" },
  asset: { label: "Personal-use asset", liquidity: "personal_use" },
};

// From most to least liquid, as on a personal balance sheet
export const LIQUIDITY_CLASSES = [
  { key: "cash_and_equivalents", label: "Cash & cash equivalents", howLiquid: "spendable today, at exactly this value" },
  { key: "restricted", label: "Restricted cash", howLiquid: "real money, but only for some purchases" },
  { key: "investments", label: "Investments", howLiquid: "a few days to sell, at that day's price" },
  { key: "personal_use", label: "Personal-use assets", howLiquid: "money only once sold; the value is your estimate" },
];

// "Current account"; an unknown kind is shown as it is
export const getAccountKindLabel = (kind) => ACCOUNT_KINDS[kind]?.label ?? kind;
