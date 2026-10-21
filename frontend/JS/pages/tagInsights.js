// ---- Insights > Tags: what each trip (or any tag) cost, across every category (GET /tags/report) ----
// A table of every tag with its totals; clicking one shows its detail under it: spent, received, net,
// and the spending split by category. The tag you picked is remembered.
// Only incomes and expenses count as money in and out: cash withdrawn for a trip (a movement) is
// counted as a transaction but isn't spent until an expense says what it went on.

import { elementById, createElement, fillTableBody, makeTableRowsOpenItems } from "../core/domHelpers.js";
import { euroFormatter, formatSignedEuros, formatShortDate, formatCount } from "../core/formatting.js";
import { appState } from "../core/appState.js";
import { drawHorizontalBarChart } from "../charts/horizontalBarChart.js";
import { formatForeignAmount } from "../core/currencies.js";

const SAVED_TAG_KEY = "insightsSelectedTagId";
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });

let selectedTagId = null;
try { selectedTagId = Number(localStorage.getItem(SAVED_TAG_KEY)) || null; } catch {}

// "3 apr – 17 apr 27"; across two years "28 dic 26 – 4 gen 27"; one day "3 apr 27"; nothing "—"
function formatDateRange(firstDay, lastDay) {
  if (!firstDay && !lastDay) return "—";
  if (!firstDay || !lastDay) return `${firstDay ? "from" : "until"} ${formatShortDate(firstDay ?? lastDay, true)}`;
  if (firstDay === lastDay) return formatShortDate(firstDay, true);
  const sameYear = firstDay.slice(0, 4) === lastDay.slice(0, 4);
  return `${formatShortDate(firstDay, !sameYear)} – ${formatShortDate(lastDay, true)}`;
}

// The tag's own dates if it has them (the trip), else the span of its transactions
const describeTagDates = (tag) =>
  tag.start_date || tag.end_date ? formatDateRange(tag.start_date, tag.end_date) : formatDateRange(tag.first_date, tag.last_date);

const createNetCell = (net) => createElement("span", net > 0 ? "pos" : net < 0 ? "neg" : "", formatSignedEuros(net));

function renderTagTable(tags) {
  fillTableBody("tag-report-body", tags, (tag) => [
    tag.name,
    describeTagDates(tag),
    tag.transaction_count,
    euroFormatter.format(tag.spent),
    euroFormatter.format(tag.received),
    createNetCell(tag.net),
  ]);
  makeTableRowsOpenItems("tag-report-body", tags, (tag) => selectTag(tag.id), (tag) => `Show what "${tag.name}" adds up to`);
  [...elementById("tag-report-body").rows].forEach((tableRow, index) => tableRow.classList.toggle("selected", tags[index].id === selectedTagId));
}

function renderTagDetail(tag) {
  elementById("tag-detail").hidden = !tag;
  if (!tag) return;
  elementById("tag-detail-title").textContent = tag.name;
  elementById("tag-spent").textContent = euroFormatter.format(tag.spent);
  elementById("tag-received").textContent = euroFormatter.format(tag.received);
  const netElement = elementById("tag-net");
  netElement.textContent = formatSignedEuros(tag.net);
  netElement.className = tag.net > 0 ? "pos" : tag.net < 0 ? "neg" : "";

  const plannedDates = tag.start_date || tag.end_date ? ` · planned ${formatDateRange(tag.start_date, tag.end_date)}` : "";
  const transactionDates = tag.transaction_count ? `, ${formatDateRange(tag.first_date, tag.last_date)}` : "";
  elementById("tag-spent-detail").textContent = `${formatCount(tag.transaction_count, "transaction")}${transactionDates}${plannedDates}`;
  const incomeNames = tag.income_by_category.map((row) => `${row.name} ${euroFormatter.format(row.total)}`).join(", ");
  elementById("tag-received-detail").textContent = incomeNames || "nothing received";
  elementById("tag-net-detail").textContent = tag.net < 0 ? "what it cost you overall" : "more came in than went out";

  renderTagCurrencies(tag);
  drawHorizontalBarChart("tag-category-chart", tag.expenses_by_category.map((row) => ({
    name: row.name,
    value: row.total,
    label: `${euroFormatter.format(row.total)} · ${percentFormatter.format(tag.spent ? row.total / tag.spent : 0)}`,
    colorClass: "neg",
  })));
}

// Paid in other currencies (migration 14): per currency, what was spent in it, what that came to in euros, and
// what the exchange rates cost against the market. Hidden when the whole trip was in euros.
function renderTagCurrencies(tag) {
  const currencyRows = tag.by_currency ?? [];
  elementById("tag-currencies").hidden = currencyRows.length === 0;
  if (!currencyRows.length) return;
  const formatOriginal = (amount, currency) => (amount ? formatForeignAmount(amount, currency) : "—");
  fillTableBody("tag-currencies-body", currencyRows, (row) => [
    row.currency,
    formatOriginal(row.spent_original, row.currency),
    row.spent ? euroFormatter.format(row.spent) : "—",
    row.received_original ? `${formatOriginal(row.received_original, row.currency)} (${euroFormatter.format(row.received)})` : "—",
    createElement("span", row.exchange_cost > 0 ? "neg" : row.exchange_cost < 0 ? "pos" : "", euroFormatter.format(row.exchange_cost)),
  ]);
  elementById("tag-exchange-cost").textContent = euroFormatter.format(tag.exchange_cost);
  const ratelessCount = currencyRows.reduce((sum, row) => sum + row.rateless_count, 0);
  elementById("tag-currencies-note").textContent =
    "Exchange cost: what the rates your card and the ATMs used cost you compared with the market rate of each day, "
    + "cash withdrawals included. It's part of the euros you paid, not an extra on top of them."
    + (ratelessCount ? ` ${formatCount(ratelessCount, "transaction")} still without a market rate (they're added once netto can reach Yahoo) aren't counted yet.` : "");
}

function selectTag(tagId) {
  selectedTagId = tagId;
  try { localStorage.setItem(SAVED_TAG_KEY, String(tagId)); } catch {}
  renderTagInsights();
}

export function renderTagInsights() {
  const tags = appState.tagReport;
  elementById("tag-report-empty").hidden = tags.length > 0;
  elementById("tag-report-table").hidden = tags.length === 0;
  // the remembered tag, else the newest one that has transactions, else the first
  if (!tags.some((tag) => tag.id === selectedTagId)) selectedTagId = (tags.find((tag) => tag.transaction_count > 0) ?? tags[0])?.id ?? null;
  renderTagTable(tags);
  renderTagDetail(tags.find((tag) => tag.id === selectedTagId));
}
