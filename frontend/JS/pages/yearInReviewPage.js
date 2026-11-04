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
import { t, dateLocale, nameOfCategory } from "../core/i18n.js";

const SAVED_YEAR_KEY = "yearInReviewYear";
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const precisePercentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatMonth = (yearMonth) => new Date(yearMonth + "-15T12:00").toLocaleDateString(dateLocale, { month: "long" });
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
    createElement("span", "yr-muted", " " + t("from {amount}", { amount: wholeEuroFormatter.format(netWorth.start) })));
  return createCard(review.is_year_to_date ? t("Net worth so far") : t("Net worth"), headline, createFigureRows([
    [t("You saved (income − expenses)"), formatSignedWholeEuros(netWorth.from_savings), signClass(netWorth.from_savings)],
    [t("Your investments did"), formatSignedWholeEuros(netWorth.from_investments), signClass(netWorth.from_investments)],
    ...(Math.abs(netWorth.other) >= 0.5 ? [[t("Other (reconciliations, new accounts)"), formatSignedWholeEuros(netWorth.other), signClass(netWorth.other)]] : []),
  ]));
}

function createMoneyInAndOutCard(review) {
  return createCard(t("Money in and out"), createFigureRows([
    [t("Income"), euroFormatter.format(review.income)],
    [t("Expenses"), euroFormatter.format(review.expenses)],
    [t("Saved"), euroFormatter.format(review.net_savings), signClass(review.net_savings)],
    [t("Savings rate"), review.savings_rate === null ? "—" : percentFormatter.format(review.savings_rate), signClass(review.savings_rate ?? 0)],
  ]));
}

function createTopCategoriesCard(review) {
  if (!review.top_expense_categories.length) return null;
  const chart = createElement("div", "hbars");
  chart.id = "yr-top-categories";
  return createCard(t("Where it went"), chart);
}

function createChangesCard(review) {
  const changes = review.category_changes;
  if (!changes || (!changes.grew.length && !changes.shrank.length)) return null;
  const sameDates = review.is_year_to_date
    ? t("Against the same dates of {year} ({from} – {to}).", { year: review.year - 1, from: formatShortDate(changes.compared_with.from, true), to: formatShortDate(changes.compared_with.to, true) })
    : t("Against {year}.", { year: review.year - 1 });
  const describe = (row) => `${formatSignedWholeEuros(row.change)}${row.change_share === null ? ` (${t("new")})` : ` (${formatSignedPercent(row.change_share)})`}`;
  const rows = [
    ...changes.grew.map((row) => [`${nameOfCategory(row)} ↑`, describe(row), "neg"]),
    ...changes.shrank.map((row) => [`${nameOfCategory(row)} ↓`, describe(row), "pos"]),
  ];
  return createCard(t("Compared with last year"), createElement("p", "hint small yr-note", sameDates), createFigureRows(rows));
}

function createMonthsCard(review) {
  if (!review.best_month) return null;
  const rows = [[t("Best month"), `${formatMonth(review.best_month.month)} · ${t("saved {amount}", { amount: wholeEuroFormatter.format(review.best_month.saved) })}`, "pos"]];
  if (review.worst_month && review.worst_month.month !== review.best_month.month) {
    const worstAmount = wholeEuroFormatter.format(Math.abs(review.worst_month.saved));
    rows.push([t("Worst month"), `${formatMonth(review.worst_month.month)} · ${review.worst_month.saved >= 0 ? t("saved {amount}", { amount: worstAmount }) : t("spent {amount} more than came in", { amount: worstAmount })}`, signClass(Math.min(0, review.worst_month.saved))]);
  }
  return createCard(t("Best and worst month"), createFigureRows(rows),
    review.is_year_to_date ? createElement("p", "hint small yr-note", t("Complete months only: this one isn't over yet.")) : null);
}

function createTripsCard(review) {
  if (!review.trips) return null;
  const list = createElement("div", "yr-trips");
  for (const trip of review.trips) {
    const tripBox = createElement("div", "yr-trip");
    const dates = trip.start_date && trip.end_date ? `${formatShortDate(trip.start_date)} – ${formatShortDate(trip.end_date, true)} · ${t("{count} days", { count: trip.days })}` : formatShortDate(trip.start_date ?? trip.end_date, true);
    tripBox.append(createElement("strong", "", trip.name), createElement("span", "yr-muted", dates));
    const details = [t("cost {amount}", { amount: euroFormatter.format(trip.cost) })];
    if (trip.cost_per_day !== null) details.push(t("{amount} a day", { amount: euroFormatter.format(trip.cost_per_day) }));
    if (trip.currencies.length) details.push(t("exchange cost {amount}", { amount: `${euroFormatter.format(trip.exchange_cost)} (${trip.currencies.join(", ")})` }));
    tripBox.append(createElement("span", "", details.join(" · ")));
    list.append(tripBox);
  }
  return createCard(review.trips.length === 1 ? t("Trip") : t("Trips ({count})", { count: review.trips.length }), list,
    createElement("p", "hint small yr-note", t("A trip is a tag with dates. Cost = what was spent with the tag minus what came back (refunds).")));
}

function createInvestmentsCard(review) {
  const investments = review.investments;
  if (!investments) return null;
  const returnRows = [];
  const moneyWeighted = investments.money_weighted, timeWeighted = investments.time_weighted;
  // a year-to-date period under a year: the plain return (annualising a few months gives silly numbers)
  const isShort = investments.days < 365;
  if (moneyWeighted) returnRows.push([isShort ? t("Your return (money-weighted, so far)") : t("Your return (money-weighted)"), precisePercentFormatter.format(isShort ? moneyWeighted.period : moneyWeighted.annual), signClass(moneyWeighted.period)]);
  if (timeWeighted) returnRows.push([isShort ? t("The investments (time-weighted, so far)") : t("The investments (time-weighted)"), precisePercentFormatter.format(isShort ? timeWeighted.period : timeWeighted.annual), signClass(timeWeighted.period)]);
  const allocationChart = createElement("div", "hbars");
  allocationChart.id = "yr-allocation";
  return createCard(t("Investments"), createFigureRows([
    [investments.net_put_in >= 0 ? t("Money put in") : t("Money taken out"), `${euroFormatter.format(Math.abs(investments.net_put_in))}${investments.sold && investments.bought ? " " + t("(bought {bought}, sold {sold})", { bought: wholeEuroFormatter.format(investments.bought), sold: wholeEuroFormatter.format(investments.sold) }) : ""}`],
    [t("Gain"), formatSignedWholeEuros(investments.gain), signClass(investments.gain)],
    ...returnRows,
  ]),
  investments.allocation.length ? createElement("h4", "yr-subtitle", investments.targets_set ? t("At the end of the year, against your targets") : t("At the end of the year")) : null,
  investments.allocation.length ? allocationChart : null);
}

function createStampDutyCard(review) {
  if (!review.stamp_duty.total) return null;
  return createCard(t("Imposta di bollo (estimate)"), createFigureRows([
    [t("On securities"), euroFormatter.format(review.stamp_duty.securities)],
    [t("On current accounts"), euroFormatter.format(review.stamp_duty.current_accounts)],
    [t("Total"), euroFormatter.format(review.stamp_duty.total)],
  ]), createElement("p", "hint small yr-note", t("The same estimate as on Statements, prorated to the days of the year so far.")));
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
  const period = review.is_year_to_date ? t("{from} – {to}, so far", { from: formatShortDate(review.from), to: formatShortDate(review.to, true) }) : t("the whole year");
  const startNote = review.from !== `${review.year}-01-01` ? " " + t("(your records start on {date})", { date: formatShortDate(review.from, true) }) : "";
  elementById("yr-period").textContent = `${review.year}: ${period}${startNote}.`;
  elementById("yr-cards").replaceChildren(...[
    createNetWorthCard(review), createMoneyInAndOutCard(review), createTopCategoriesCard(review), createChangesCard(review),
    createMonthsCard(review), createTripsCard(review), createInvestmentsCard(review), createStampDutyCard(review),
  ].filter(Boolean));

  // the bar charts need their containers on the page first
  if (review.top_expense_categories.length) {
    drawHorizontalBarChart("yr-top-categories", review.top_expense_categories.map((category) => ({
      name: nameOfCategory(category), value: category.total, colorClass: "neg",
      label: `${wholeEuroFormatter.format(category.total)} · ${percentFormatter.format(category.share)}`,
    })));
  }
  if (review.investments?.allocation.length) {
    drawHorizontalBarChart("yr-allocation", review.investments.allocation.map((row) => ({
      name: row.ticker, value: row.share, colorClass: "share",
      label: `${precisePercentFormatter.format(row.share)}${row.target_share ? ` · ${t("target {share}", { share: percentFormatter.format(row.target_share) })}` : ""}`,
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
