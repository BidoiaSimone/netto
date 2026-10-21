/* THE CURRENCIES A TRANSACTION CAN BE PAID IN, and how many decimals each one has.
 * The only place this list lives: the frontend asks for it (GET /currencies) instead of keeping its own copy.
 *
 * Every account in netto is in euros, and every balance is counted in euro cents. A foreign currency is only a
 * note on a transaction: "this 7,45 € was ¥1.200 at the till". That foreign amount is stored as an integer too,
 * in the currency's own MINOR UNITS, and "cents" would be the wrong word for them:
 *
 *   2 decimals   most currencies: 12,50 US$ = 1250 minor units (cents)
 *   0 decimals   the yen has no smaller unit in use: ¥1.200 = 1200 minor units (a yen is already the smallest)
 *   3 decimals   a few Gulf and North African currencies: 1,250 KWD = 1250 minor units (fils, 1/1000 of a dinar)
 *
 * So "1200" means ¥1.200 or 12,00 $ or 1,200 KWD depending on the currency: an amount is only meaningful
 * together with its code, which is why both columns are always set together (migration 14).
 * The decimals are the ISO 4217 "minor unit" of each currency (https://www.iso.org/iso-4217-currency-codes.html,
 * checked October 2026). EUR is listed for completeness (and for the tests), but a transaction can't be
 * "paid in euros" as a foreign currency: its euro amount already is that.
 */

const NETTO_CURRENCY = "EUR";

// code -> [decimals, name]. Roughly the currencies a European is likely to pay in; add more freely.
const CURRENCY_DECIMALS_AND_NAMES = {
  EUR: [2, "Euro"],
  USD: [2, "US dollar"],
  GBP: [2, "Pound sterling"],
  CHF: [2, "Swiss franc"],
  JPY: [0, "Japanese yen"],
  KRW: [0, "South Korean won"],
  CNY: [2, "Chinese yuan"],
  HKD: [2, "Hong Kong dollar"],
  TWD: [2, "New Taiwan dollar"],
  SGD: [2, "Singapore dollar"],
  THB: [2, "Thai baht"],
  VND: [0, "Vietnamese dong"],
  IDR: [2, "Indonesian rupiah"],
  MYR: [2, "Malaysian ringgit"],
  PHP: [2, "Philippine peso"],
  INR: [2, "Indian rupee"],
  AUD: [2, "Australian dollar"],
  NZD: [2, "New Zealand dollar"],
  CAD: [2, "Canadian dollar"],
  MXN: [2, "Mexican peso"],
  BRL: [2, "Brazilian real"],
  ARS: [2, "Argentine peso"],
  CLP: [0, "Chilean peso"],
  COP: [2, "Colombian peso"],
  PEN: [2, "Peruvian sol"],
  SEK: [2, "Swedish krona"],
  NOK: [2, "Norwegian krone"],
  DKK: [2, "Danish krone"],
  ISK: [0, "Icelandic króna"],
  PLN: [2, "Polish złoty"],
  CZK: [2, "Czech koruna"],
  HUF: [2, "Hungarian forint"],
  RON: [2, "Romanian leu"],
  RSD: [2, "Serbian dinar"],
  ALL: [2, "Albanian lek"],
  TRY: [2, "Turkish lira"],
  ILS: [2, "Israeli new shekel"],
  AED: [2, "UAE dirham"],
  SAR: [2, "Saudi riyal"],
  QAR: [2, "Qatari riyal"],
  KWD: [3, "Kuwaiti dinar"],
  BHD: [3, "Bahraini dinar"],
  OMR: [3, "Omani rial"],
  JOD: [3, "Jordanian dinar"],
  TND: [3, "Tunisian dinar"],
  EGP: [2, "Egyptian pound"],
  MAD: [2, "Moroccan dirham"],
  ZAR: [2, "South African rand"],
  KES: [2, "Kenyan shilling"],
  XOF: [0, "West African CFA franc"],
};

// Undefined for a code that isn't in the list
const getCurrencyDecimals = (currencyCode) => CURRENCY_DECIMALS_AND_NAMES[currencyCode]?.[0];

// Can a transaction be paid in this currency? (known, and not the euro itself)
const isForeignCurrency = (currencyCode) => currencyCode !== NETTO_CURRENCY && getCurrencyDecimals(currencyCode) !== undefined;

// 1200 JPY -> 1200, 12.5 USD -> 1250, 1.25 KWD -> 1250. NaN for anything that isn't a number or a known currency.
// Same float-noise guard as convertEurosToCents (utils/moneyConversion.js): 1.005 $ is 101 cents, not 100.
function convertToMinorUnits(amount, currencyCode) {
  const decimals = getCurrencyDecimals(currencyCode);
  if (decimals === undefined || amount === null || amount === undefined || amount === "") return NaN;
  const number = Number(amount);
  if (!Number.isFinite(number)) return NaN;
  return Math.round(Number((number * 10 ** decimals).toPrecision(15)));
}

// 1250 USD -> 12.5, 1200 JPY -> 1200. null passes through.
function convertFromMinorUnits(minorUnits, currencyCode) {
  if (minorUnits === null || minorUnits === undefined) return null;
  return minorUnits / 10 ** getCurrencyDecimals(currencyCode);
}

// For GET /currencies: [{ code, name, decimals }], euro excluded, by code
const listForeignCurrencies = () =>
  Object.entries(CURRENCY_DECIMALS_AND_NAMES)
    .filter(([code]) => code !== NETTO_CURRENCY)
    .map(([code, [decimals, name]]) => ({ code, name, decimals }))
    .sort((first, second) => first.code.localeCompare(second.code));

module.exports = { NETTO_CURRENCY, getCurrencyDecimals, isForeignCurrency, convertToMinorUnits, convertFromMinorUnits, listForeignCurrencies };
