// ---- how a transaction is shown in the lists (Home and Transactions pages): amount, description, round icon, day ----

import { createElement } from "./domHelpers.js";
// single transactions stay readable with Hide amounts on (see core/formatting.js)
import { visibleEuroFormatter as euroFormatter, getTodayAsLocalDate, getLocalDateDaysFromToday } from "./formatting.js";
import { formatForeignAmount, formatUnitsPerEuro } from "./currencies.js";
import { createCategoryIcon, createTypeIcon, createUncategorizedIcon, findCategory } from "./categoryIcons.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

// +1 money in, -1 money out, 0 a movement between your own accounts
function getMoneyDirection(transaction) {
  if (transaction.type === "income") return 1;
  if (transaction.type === "adjustment") return transaction.to_account ? 1 : -1;
  if (transaction.type === "expense") return -1;
  if (transaction.type === "investment") return transaction.to_account ? 1 : -1;
  return 0;
}

// The description, with a ↻ when a recurring transaction added it
export function createDescriptionCell(transaction) {
  const cell = createElement("span", "", transaction.description ?? "");
  if (transaction.recurring_transaction_id) {
    const marker = createElement("span", "recurring-marker", "↻");
    marker.title = "Added by a recurring transaction";
    cell.prepend(marker);
  }
  return cell;
}

// Green for money in, red for money out, plain for movements.
// Investment trades show their direction (+ sold, − bought) but no colour: money changing form, not income or spending.
// Paid in another currency: the foreign amount under the euros ("1200 ¥"), and the rates in the tooltip.
export function createSignedAmountCell(transaction) {
  const direction = getMoneyDirection(transaction);
  const colourClass = transaction.type === "investment" ? "" : direction > 0 ? "pos" : direction < 0 ? "neg" : "";
  const sign = direction > 0 ? "+" : direction < 0 ? "−" : "";
  const euroAmount = createElement("span", colourClass, sign + euroFormatter.format(transaction.amount));
  if (!transaction.original_currency) return euroAmount;

  const cell = createElement("span", "amount-with-original");
  cell.append(euroAmount, createElement("small", "original-amount", formatForeignAmount(transaction.original_amount, transaction.original_currency)));
  cell.title = describeExchange(transaction);
  return cell;
}

// "1200 ¥ at 157,89 per € · market 160,00 per € · exchange cost 0,10 € (1,3%)"
function describeExchange(transaction) {
  const parts = [`${formatForeignAmount(transaction.original_amount, transaction.original_currency)}`];
  if (transaction.charged_rate) parts[0] += ` at ${formatUnitsPerEuro(transaction.charged_rate)} per €`;
  if (transaction.original_market_rate) parts.push(`market ${formatUnitsPerEuro(transaction.original_market_rate)} per €`);
  if (transaction.exchange_cost !== null && transaction.exchange_cost !== undefined) {
    const share = transaction.exchange_cost_share === null ? "" : ` (${percentFormatter.format(Math.abs(transaction.exchange_cost_share))})`;
    parts.push(`exchange ${transaction.exchange_cost >= 0 ? "cost" : "gain"} ${euroFormatter.format(Math.abs(transaction.exchange_cost))}${share}`);
  } else if (transaction.original_market_rate === null) {
    parts.push("market rate not known yet");
  }
  return parts.join(" · ");
}

// ---------- Pocket's lists: the round icon leading each row, and the day ----------

// The category's icon and colour, as chosen on the Categories page (core/categoryIcons.js); a category without an
// icon shows its initial, on a colour picked by its name; no category at all, a grey "?". Movements,
// reconciliations and trades have a drawing of their own. Pocket's lists only (Classic hides it).
export function createTransactionIcon(transaction) {
  const typeIcon = createTypeIcon(transaction.type);
  if (typeIcon) return typeIcon;
  const category = findCategory(transaction.category_id);
  return category ? createCategoryIcon(category) : createUncategorizedIcon();
}

const dayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const dayWithYearFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

// "Today", "Yesterday", "Sun 18 Oct" (with the year when it isn't this year's)
export function describeDay(date) {
  if (date === getLocalDateDaysFromToday(0)) return "Today";
  if (date === getLocalDateDaysFromToday(-1)) return "Yesterday";
  const day = new Date(`${date}T12:00:00`);
  return (date.slice(0, 4) === getTodayAsLocalDate().slice(0, 4) ? dayFormatter : dayWithYearFormatter).format(day);
}

// A movement's title: where the money went from and to, "Edenred → BBVA"
export function describeMovementRoute(transaction) {
  return `${transaction.from_account ?? "—"} → ${transaction.to_account ?? "—"}`;
}
