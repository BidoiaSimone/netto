/* CHECKS AN ACCOUNT SENT BY THE FRONTEND (add and edit follow the same rules) */

const { convertEurosToCents } = require("../utils/moneyConversion.js");
const { ACCOUNT_KIND_NAMES } = require("../../config/accountKinds.js");

// Returns { error } or { account: { name, kind, openingBalance } } (opening balance in cents)
function validateAccount(requestBody) {
  const name = String(requestBody?.name ?? "").trim();
  const openingBalance = convertEurosToCents(requestBody?.opening_balance);
  const kind = requestBody?.kind ?? "cash";

  if (!name || !Number.isFinite(openingBalance)) return { error: "name and a numeric opening_balance are required" };
  if (!ACCOUNT_KIND_NAMES.includes(kind)) return { error: `kind must be one of: ${ACCOUNT_KIND_NAMES.join(", ")}` };
  return { account: { name, kind, openingBalance } };
}

module.exports = { validateAccount, ACCOUNT_KINDS: ACCOUNT_KIND_NAMES };
