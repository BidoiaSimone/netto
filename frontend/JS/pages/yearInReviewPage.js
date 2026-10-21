// ---- Year in review page: one year of your money, read in a minute (GET /year-in-review?year=) ----
// A column of cards, made for scrolling on a phone: net worth and what changed it, money in and out, where it went,
// against last year, best and worst month, trips, investments, stamp duty. A card with nothing to say (no trips,
// no investments that year) isn't shown. The numbers are the Statements page's for the same year
// (backend/server/services/yearInReview.js). The year shown is remembered.

import { elementById, createElement, highlightSelectedChip } from "../core/domHelpers.js";
import { euroFormatter, wholeEuroFormatter, formatSignedWholeEuros, formatShortDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { drawHorizontalBarChart } from "../charts/horizontalBarChart.js";

const SAVED_YEAR_KEY = "yearInReviewYear";
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const precisePercentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatMonth = (yearMonth) => new Date(yearMonth + "-15T12:00").toLocaleDateString("en-GB", { month: "long" });
const formatSignedPercent = (share) => `${share > 0 ? "+" : share < 0 ? "−" : ""}${percentFormatter.format(Math.abs(share))}`;

let selectedYear = null;
try { selectedYear = Number(localStorage.getItem(SAVED_YEAR_KEY)) || null; } catch {}
let latestRequestNumber = 0;

export async function loadYearInReview() {
  const requestNumber = ++latestRequestNumber;
  let review;
  try {
    review = await callApi(`/year-in-review${selectedYear ? `?year=${selectedYear}` : ""}`);
  } catch (error) {
    if (selectedYear && error.status === 400) { // a remembered year that no longer has records: back to this year
      selectedYear = null;
      return loadYearInReview();
    }
    throw error;
  }
  if (requestNumber === latestRequestNumber) renderYearInReview(review);
}

// A card: a title, then its rows; null contents = the card isn't shown
function createCard(title, ...contents) {
  const card = createElement("section", "panel yr-card");
  card.append(createElement("h3", "", title), ...contents.filter(Boolean));
  return card;
}

// "Saved  +9.445 €" lines
function createFigureRows(rows) {
  const list = createElement("dl", "yr-figures");
  for (const [label, value, className = ""] of rows) {
    list.append(createElement("dt", "", label), createElement("dd", className, value));
  }
  return list;
}
const signClass = (amount) => (amount > 0 ? "pos" : amount < 0 ? "neg" : "");

function createNetWorthCard(review) {
  const { net_worth: netWorth } = review;
  const headline = createElement("p", "yr-headline");
  headline.append(createElement("strong", "", wholeEuroFormatter.format(netWorth.end)),
    createElement("span", signClass(netWorth.change), ` ${formatSignedWholeEuros(netWorth.change)}`),
    createElement("span", "yr-muted", ` from ${wholeEuroFormatter.format(netWorth.start)}`));
  return createCard(review.is_year_to_date ? "Net worth so far" : "Net worth", headline, createFigureRows([
    ["You saved (income − expenses)", formatSignedWholeEuros(netWorth.from_savings), signClass(netWorth.from_savings)],
    ["Your investments did", formatSignedWholeEuros(netWorth.from_investments), signClass(netWorth.from_investments)],
    ...(Math.abs(netWorth.other) >= 0.5 ? [["Other (reconciliations, new accounts)", formatSignedWholeEuros(netWorth.other), signClass(netWorth.other)]] : []),
  ]));
}

function createMoneyInAndOutCard(review) {
  return createCard("Money in and out", createFigureRows([
    ["Income", euroFormatter.format(review.income)],
    ["Expenses", euroFormatter.format(review.expenses)],
    ["Saved", euroFormatter.format(review.net_savings), signClass(review.net_savings)],
    ["Savings rate", review.savings_rate === null ? "—" : percentFormatter.format(review.savings_rate), signClass(review.savings_rate ?? 0)],
  ]));
}

function createTopCategoriesCard(review) {
  if (!review.top_expense_categories.length) return null;
  const chart = createElement("div", "hbars");
  chart.id = "yr-top-categories";
  return createCard("Where it went", chart);
}

function createChangesCard(review) {
  const changes = review.category_changes;
  if (!changes || (!changes.grew.length && !changes.shrank.length)) return null;
  const sameDates = review.is_year_to_date
    ? `Against the same dates of ${review.year - 1} (${formatShortDate(changes.compared_with.from, true)} – ${formatShortDate(changes.compared_with.to, true)}).`
    : `Against ${review.year - 1}.`;
  const describe = (row) => `${formatSignedWholeEuros(row.change)}${row.change_share === null ? " (new)" : ` (${formatSignedPercent(row.change_share)})`}`;
  const rows = [
    ...changes.grew.map((row) => [`${row.name} ↑`, describe(row), "neg"]),
    ...changes.shrank.map((row) => [`${row.name} ↓`, describe(row), "pos"]),
  ];
  return createCard("Compared with last year", createElement("p", "hint small yr-note", sameDates), createFigureRows(rows));
}

function createMonthsCard(review) {
  if (!review.best_month) return null;
  const rows = [["Best month", `${formatMonth(review.best_month.month)} · saved ${wholeEuroFormatter.format(review.best_month.saved)}`, "pos"]];
  if (review.worst_month && review.worst_month.month !== review.best_month.month) {
    rows.push(["Worst month", `${formatMonth(review.worst_month.month)} · ${review.worst_month.saved >= 0 ? "saved" : "spent"} ${wholeEuroFormatter.format(Math.abs(review.worst_month.saved))}${review.worst_month.saved < 0 ? " more than came in" : ""}`, signClass(Math.min(0, review.worst_month.saved))]);
  }
  return createCard("Best and worst month", createFigureRows(rows),
    review.is_year_to_date ? createElement("p", "hint small yr-note", "Complete months only: this one isn't over yet.") : null);
}

function createTripsCard(review) {
  if (!review.trips) return null;
  const list = createElement("div", "yr-trips");
  for (const trip of review.trips) {
    const tripBox = createElement("div", "yr-trip");
    const dates = trip.start_date && trip.end_date ? `${formatShortDate(trip.start_date)} – ${formatShortDate(trip.end_date, true)} · ${trip.days} days` : formatShortDate(trip.start_date ?? trip.end_date, true);
    tripBox.append(createElement("strong", "", trip.name), createElement("span", "yr-muted", dates));
    const details = [`cost ${euroFormatter.format(trip.cost)}`];
    if (trip.cost_per_day !== null) details.push(`${euroFormatter.format(trip.cost_per_day)} a day`);
    if (trip.currencies.length) details.push(`exchange cost ${euroFormatter.format(trip.exchange_cost)} (${trip.currencies.join(", ")})`);
    tripBox.append(createElement("span", "", details.join(" · ")));
    list.append(tripBox);
  }
  return createCard(review.trips.length === 1 ? "Trip" : `Trips (${review.trips.length})`, list,
    createElement("p", "hint small yr-note", "A trip is a tag with dates. Cost = what was spent with the tag minus what came back (refunds)."));
}

function createInvestmentsCard(review) {
  const investments = review.investments;
  if (!investments) return null;
  const returnRows = [];
  const moneyWeighted = investments.money_weighted, timeWeighted = investments.time_weighted;
  // a year-to-date period under a year: the plain return (annualising a few months gives silly numbers)
  const isShort = investments.days < 365;
  if (moneyWeighted) returnRows.push([`Your return (money-weighted${isShort ? ", so far" : ""})`, precisePercentFormatter.format(isShort ? moneyWeighted.period : moneyWeighted.annual), signClass(moneyWeighted.period)]);
  if (timeWeighted) returnRows.push([`The investments (time-weighted${isShort ? ", so far" : ""})`, precisePercentFormatter.format(isShort ? timeWeighted.period : timeWeighted.annual), signClass(timeWeighted.period)]);
  const allocationChart = createElement("div", "hbars");
  allocationChart.id = "yr-allocation";
  return createCard("Investments", createFigureRows([
    [investments.net_put_in >= 0 ? "Money put in" : "Money taken out", `${euroFormatter.format(Math.abs(investments.net_put_in))}${investments.sold && investments.bought ? ` (bought ${wholeEuroFormatter.format(investments.bought)}, sold ${wholeEuroFormatter.format(investments.sold)})` : ""}`],
    ["Gain", formatSignedWholeEuros(investments.gain), signClass(investments.gain)],
    ...returnRows,
  ]),
  investments.allocation.length ? createElement("h4", "yr-subtitle", investments.targets_set ? "At the end of the year, against your targets" : "At the end of the year") : null,
  investments.allocation.length ? allocationChart : null);
}

function createStampDutyCard(review) {
  if (!review.stamp_duty.total) return null;
  return createCard("Imposta di bollo (estimate)", createFigureRows([
    ["On securities", euroFormatter.format(review.stamp_duty.securities)],
    ["On current accounts", euroFormatter.format(review.stamp_duty.current_accounts)],
    ["Total", euroFormatter.format(review.stamp_duty.total)],
  ]), createElement("p", "hint small yr-note", "The same estimate as on Statements, prorated to the days of the year so far."));
}

function renderYearChips(review) {
  const chips = elementById("yr-years");
  chips.replaceChildren(...review.years_available.map((year) => {
    const chip = createElement("button", "ghost", String(year));
    chip.type = "button";
    chip.dataset.value = String(year);
    return chip;
  }));
  highlightSelectedChip(chips, String(review.year));
}

function renderYearInReview(review) {
  selectedYear = review.year;
  renderYearChips(review);
  const period = review.is_year_to_date ? `${formatShortDate(review.from)} – ${formatShortDate(review.to, true)}, so far` : `the whole year`;
  const startNote = review.from !== `${review.year}-01-01` ? ` (your records start on ${formatShortDate(review.from, true)})` : "";
  elementById("yr-period").textContent = `${review.year}: ${period}${startNote}.`;
  elementById("yr-cards").replaceChildren(...[
    createNetWorthCard(review), createMoneyInAndOutCard(review), createTopCategoriesCard(review), createChangesCard(review),
    createMonthsCard(review), createTripsCard(review), createInvestmentsCard(review), createStampDutyCard(review),
  ].filter(Boolean));

  // the bar charts need their containers on the page first
  if (review.top_expense_categories.length) {
    drawHorizontalBarChart("yr-top-categories", review.top_expense_categories.map((category) => ({
      name: category.name, value: category.total, colorClass: "neg",
      label: `${wholeEuroFormatter.format(category.total)} · ${percentFormatter.format(category.share)}`,
    })));
  }
  if (review.investments?.allocation.length) {
    drawHorizontalBarChart("yr-allocation", review.investments.allocation.map((row) => ({
      name: row.ticker, value: row.share, colorClass: "share",
      label: `${precisePercentFormatter.format(row.share)}${row.target_share ? ` · target ${percentFormatter.format(row.target_share)}` : ""}`,
    })));
  }
}

export function initializeYearInReviewPage() {
  elementById("yr-years").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    selectedYear = Number(chip.dataset.value);
    try { localStorage.setItem(SAVED_YEAR_KEY, String(selectedYear)); } catch {}
    loadYearInReview().catch((error) => showErrorMessage(error.message));
  });
}
