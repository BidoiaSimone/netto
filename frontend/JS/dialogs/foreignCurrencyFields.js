// ---- the transaction dialog's "paid in another currency" part (migration 14) ----
// On a trip: tap "Paid in JPY", type the 1200 on the receipt, and the euros are filled in at that day's market rate.
// The euro amount stays editable, because the bank's rate is a little worse than the market's and what the bank
// charged is the real amount. Once you type the euros yourself they're never overwritten again.
// Under the fields: the market rate, the rate you were really charged, and what the difference cost you.
//
// The last currency used is remembered (this browser only), so a whole trip is one tap per transaction.

import { elementById } from "../core/domHelpers.js";
// single transactions stay readable with Hide amounts on (see core/formatting.js)
import { visibleEuroFormatter as euroFormatter, formatShortDate, getTodayAsLocalDate } from "../core/formatting.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { evaluateAmount } from "../core/amountExpression.js";
import { fillCurrencyPicker, formatForeignAmount, formatUnitsPerEuro, getCurrencySymbol } from "../core/currencies.js";

const LAST_CURRENCY_KEY = "lastForeignCurrency";
const DEFAULT_CURRENCY = "USD";
const RATE_LOOKUP_DELAY_MILLISECONDS = 250; // wait for a pause in the typing before asking the server

let euroAmountTypedByHand = false;   // true once you type the euros: from then on they're yours
let rateLookupTimer = null;
const rateByCurrencyAndDate = new Map(); // "JPY 2026-10-14" -> the server's answer, or an Error

function readLastCurrency() {
  try { return localStorage.getItem(LAST_CURRENCY_KEY); } catch { return null; }
}
export function rememberLastCurrency(currencyCode) {
  try { localStorage.setItem(LAST_CURRENCY_KEY, currencyCode); } catch {}
}

const isForeignCurrencyOn = () => !elementById("tx-fx-inputs").hidden;
const euroAmountInput = () => elementById("tx-form").amount;

// "Paid in JPY" when a currency was used before (one tap), "Paid in another currency" the first time
function updateToggleLabel() {
  const lastCurrency = readLastCurrency();
  elementById("tx-fx-toggle").textContent = lastCurrency ? `+ Paid in ${lastCurrency}` : "+ Paid in another currency";
}

export function showForeignCurrencyFields(currencyCode, foreignAmount = "") {
  fillCurrencyPicker(elementById("tx-fx-currency"));
  elementById("tx-fx-currency").value = currencyCode || readLastCurrency() || DEFAULT_CURRENCY;
  elementById("tx-fx-amount").value = foreignAmount;
  elementById("tx-fx-inputs").hidden = false;
  elementById("tx-fx-toggle").hidden = true;
  euroAmountInput().placeholder = "€ charged";
  updateForeignAmountPlaceholder();
  refreshRateAndInfo();
}

export function hideForeignCurrencyFields() {
  elementById("tx-fx-inputs").hidden = true;
  elementById("tx-fx-toggle").hidden = false;
  elementById("tx-fx-amount").value = "";
  elementById("tx-fx-info").textContent = "";
  euroAmountInput().placeholder = "Amount";
  euroAmountTypedByHand = false;
  updateToggleLabel();
}

// Editing a saved transaction: its euros are already the real ones, so they're kept as they are
export function fillForeignCurrencyFields(transaction) {
  if (!transaction.original_currency) return hideForeignCurrencyFields();
  euroAmountTypedByHand = true;
  showForeignCurrencyFields(transaction.original_currency, transaction.original_amount);
}

// What the form sends: both fields, or neither (paid in euros)
export function readForeignCurrencyFields() {
  const foreignAmount = elementById("tx-fx-amount").value;
  if (!isForeignCurrencyOn() || foreignAmount === "") return { original_currency: null, original_amount: null };
  return { original_currency: elementById("tx-fx-currency").value, original_amount: Number(foreignAmount) };
}

// Disabled for the cash side of a trade and for reconciliations (their amount can't change either)
export function setForeignCurrencyFieldsDisabled(isDisabled) {
  elementById("tx-fx-field").hidden = isDisabled && !isForeignCurrencyOn();
  for (const id of ["tx-fx-toggle", "tx-fx-currency", "tx-fx-amount", "tx-fx-remove"]) elementById(id).disabled = isDisabled;
}

function updateForeignAmountPlaceholder() {
  const currencyCode = elementById("tx-fx-currency").value;
  const decimals = appState.currencies.find((currency) => currency.code === currencyCode)?.decimals ?? 2;
  const amountInput = elementById("tx-fx-amount");
  amountInput.placeholder = `Amount in ${currencyCode}`;
  amountInput.step = decimals === 0 ? "1" : String(1 / 10 ** decimals);
}

// The rate of one currency on one day, asked once and remembered
async function getMarketRate(currencyCode, date) {
  const cacheKey = `${currencyCode} ${date}`;
  if (!rateByCurrencyAndDate.has(cacheKey)) {
    try {
      rateByCurrencyAndDate.set(cacheKey, await callApi(`/exchange-rates/${currencyCode}?date=${date}`));
    } catch (error) {
      return error; // not remembered: the next keystroke tries again (you may be back online)
    }
  }
  return rateByCurrencyAndDate.get(cacheKey);
}

function scheduleRateRefresh() {
  clearTimeout(rateLookupTimer);
  rateLookupTimer = setTimeout(refreshRateAndInfo, RATE_LOOKUP_DELAY_MILLISECONDS);
}

// Fills the euros (unless you typed them) and writes the rates line under the fields
async function refreshRateAndInfo() {
  if (!isForeignCurrencyOn()) return;
  const currencyCode = elementById("tx-fx-currency").value;
  const foreignAmount = Number(elementById("tx-fx-amount").value);
  const date = elementById("tx-date").value || getTodayAsLocalDate();
  const info = elementById("tx-fx-info");

  const rate = await getMarketRate(currencyCode, date);
  if (!isForeignCurrencyOn() || currencyCode !== elementById("tx-fx-currency").value) return; // changed meanwhile
  if (rate instanceof Error) {
    info.textContent = "No exchange rate right now: type the euros charged.";
    return;
  }

  const symbol = getCurrencySymbol(currencyCode);
  const marketValueInEuros = foreignAmount > 0 ? Math.round((foreignAmount / rate.units_per_euro) * 100) / 100 : null;
  if (marketValueInEuros !== null && !euroAmountTypedByHand) euroAmountInput().value = marketValueInEuros.toFixed(2);

  const rateDateNote = rate.rate_date !== date ? ` (${formatShortDate(rate.rate_date)})` : "";
  const parts = [`Market: 1 € = ${formatUnitsPerEuro(rate.units_per_euro)} ${symbol}${rateDateNote}`];
  const eurosCharged = evaluateAmount(euroAmountInput().value) ?? 0;
  if (marketValueInEuros !== null && eurosCharged > 0 && euroAmountTypedByHand) {
    const isIncome = elementById("tx-type").value === "income";
    const exchangeCost = Math.round((isIncome ? marketValueInEuros - eurosCharged : eurosCharged - marketValueInEuros) * 100) / 100;
    parts.push(`charged: 1 € = ${formatUnitsPerEuro(foreignAmount / eurosCharged)} ${symbol}`);
    parts.push(exchangeCost === 0 ? "no exchange cost"
      : `exchange ${exchangeCost > 0 ? "cost" : "gain"} ${euroFormatter.format(Math.abs(exchangeCost))} (${percentFormatter.format(Math.abs(exchangeCost) / marketValueInEuros)})`);
  } else if (marketValueInEuros !== null) {
    parts.push(`${formatForeignAmount(foreignAmount, currencyCode)} ≈ ${euroFormatter.format(marketValueInEuros)}: change the euros to what the bank charged`);
  }
  info.textContent = parts.join(" · ");
}

export function initializeForeignCurrencyFields() {
  updateToggleLabel();
  elementById("tx-fx-toggle").addEventListener("click", () => {
    showForeignCurrencyFields();
    elementById("tx-fx-amount").focus();
  });
  elementById("tx-fx-remove").addEventListener("click", hideForeignCurrencyFields);
  elementById("tx-fx-currency").addEventListener("change", () => {
    updateForeignAmountPlaceholder();
    refreshRateAndInfo();
  });
  elementById("tx-fx-amount").addEventListener("input", scheduleRateRefresh);
  elementById("tx-date").addEventListener("change", scheduleRateRefresh);
  elementById("tx-type").addEventListener("change", scheduleRateRefresh);
  euroAmountInput().addEventListener("input", () => {
    if (!isForeignCurrencyOn()) return;
    euroAmountTypedByHand = euroAmountInput().value !== ""; // emptied again: the market rate may fill it once more
    scheduleRateRefresh();
  });
}
