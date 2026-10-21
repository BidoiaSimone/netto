// ---- foreign currencies: the list (from the server) and how a foreign amount is shown ----
// Every account is in euros; a transaction can also remember what it cost in another currency (migration 14).
// The list of currencies and their decimals lives on the server (backend/config/currencies.js): it's loaded
// once at startup, never copied here.

import { callApi } from "./apiClient.js";
import { appState } from "./appState.js";

export async function loadCurrencies() {
  appState.currencies = await callApi("/currencies");
}

const formatterByCurrency = new Map();

// 1200, "JPY" -> "1200 ¥"; 9.99, "USD" -> "9,99 $"; 1.25, "KWD" -> "1,250 KWD". Italian style, like the euros;
// the decimals are the currency's own (Intl knows them: none for the yen, three for the dinar).
export function formatForeignAmount(amount, currencyCode) {
  if (!formatterByCurrency.has(currencyCode)) {
    formatterByCurrency.set(currencyCode, new Intl.NumberFormat("it-IT", { style: "currency", currency: currencyCode, currencyDisplay: "narrowSymbol" }));
  }
  return formatterByCurrency.get(currencyCode).format(amount);
}

// The symbol alone ("¥", "$", "KWD"), for labels like "1 € = 160,00 ¥"
export const getCurrencySymbol = (currencyCode) =>
  formatForeignAmount(0, currencyCode).replace(/[\d\s., ]/g, "") || currencyCode;

// A rate written "units per euro": 160 -> "160,00", 0.3125 -> "0,3125" (enough digits to be useful either way)
export function formatUnitsPerEuro(unitsPerEuro) {
  const digits = unitsPerEuro >= 100 ? 2 : unitsPerEuro >= 1 ? 4 : 5;
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits, minimumFractionDigits: 2 }).format(unitsPerEuro);
}

// The currency dropdowns: "JPY · Japanese yen"
export function fillCurrencyPicker(selectElement, { emptyOptionLabel } = {}) {
  const pickedCode = selectElement.value;
  const options = appState.currencies.map((currency) => new Option(`${currency.code} · ${currency.name}`, currency.code));
  selectElement.replaceChildren(...(emptyOptionLabel ? [new Option(emptyOptionLabel, "")] : []), ...options);
  if (pickedCode) selectElement.value = pickedCode;
}
