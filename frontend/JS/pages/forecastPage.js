// ---- Forecast page: where net worth is heading (GET /forecast) ----
// Key numbers on top (net worth in 1, 2, 5, 10 years, the lowest cash point, the runway), warnings when cash
// runs out, and the chart: the real past on the left of "today", the forecast on the right, with a band for
// a 0% and an 8% return. The plan behind it (phases, events, assumptions) is edited in forecastPlanEditor.js;
// every change there answers with the whole new forecast, which is drawn here.
//
// Amounts can be shown in today's euros (each future amount ÷ the inflation since today: what it could buy at
// today's prices) or in the euros of each future month. Today's euros is the default: "200,000 € in 2036" means
// little until you know what it buys.

import { elementById, createElement, highlightSelectedChip } from "../core/domHelpers.js";
import { euroFormatter, wholeEuroFormatter } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { drawStackedAreaChart } from "../charts/stackedAreaChart.js";
import { renderForecastPlan, initializeForecastPlanEditor } from "./forecastPlanEditor.js";

const REDRAW_DELAY_AFTER_RESIZE_MILLISECONDS = 150;
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });

let forecast = null;                 // the last answer of GET /forecast (or of a change to the plan)
let moneyView = readSavedSetting("forecastMoneyView", "real"); // "real" | "nominal"
let yearsShown = Number(readSavedSetting("forecastYears", "10"));

function readSavedSetting(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

// "mar 2028"
const formatMonthYear = (date) => new Date(date + "T00:00").toLocaleDateString("it-IT", { month: "short", year: "numeric" });

// A forecast amount in the chosen money: nominal as it is, or divided by the inflation up to its month
const inChosenMoney = (amount, deflator = 1) => (moneyView === "real" ? amount / deflator : amount);

export async function loadForecast() {
  showForecast(await callApi(`/forecast?years=${yearsShown}`));
}

// Called with every new forecast (a load, or the answer to a change in the plan)
export function showForecast(newForecast) {
  forecast = newForecast;
  renderForecastPlan(forecast);
  renderForecastResults();
}

// ---------- key numbers and warnings ----------

function createKeyNumberCard(title, value, detail, className = "") {
  const card = createElement("div", "card");
  card.append(title, createElement("strong", className, value), createElement("small", "", detail));
  return card;
}

function renderKeyNumbers() {
  const todayPoint = forecast.forecast[0];
  const netWorthCards = forecast.key_numbers.net_worth_in.map((point) => {
    const value = inChosenMoney(point.net_worth, point.deflator);
    const change = value - todayPoint.net_worth;
    return createKeyNumberCard(`In ${point.years} year${point.years === 1 ? "" : "s"}`, wholeEuroFormatter.format(value),
      `${change >= 0 ? "+" : "−"}${wholeEuroFormatter.format(Math.abs(change))} from today · ${formatMonthYear(point.date)}`, change < 0 ? "neg" : "");
  });

  const lowestCash = forecast.key_numbers.lowest_cash;
  const lowestCashPoint = forecast.forecast.find((point) => point.date === lowestCash.date);
  const lowestCashCard = createKeyNumberCard("Lowest cash", wholeEuroFormatter.format(inChosenMoney(lowestCash.value, lowestCashPoint?.deflator)),
    lowestCash.date === forecast.today ? "today: it only grows from here" : formatMonthYear(lowestCash.date), lowestCash.value <= 0 ? "neg" : "");

  const runway = forecast.key_numbers.runway;
  const runwayCard = runway.months === null
    ? createKeyNumberCard("Runway", "∞", runway.phase_name ? `${runway.phase_name} brings in more than it costs` : "no phase yet")
    : createKeyNumberCard("Runway", `${runway.months.toLocaleString("it-IT", { maximumFractionDigits: 1 })} months`,
      `${wholeEuroFormatter.format(runway.liquid_now)} cash + investments ÷ ${euroFormatter.format(runway.monthly_deficit)} a month short (${runway.phase_name})`,
      runway.months < 12 ? "neg" : "");

  elementById("fc-key-numbers").replaceChildren(...netWorthCards, lowestCashCard, runwayCard);
}

function renderWarnings() {
  const { cash_runs_out: cashRunsOut, investments_run_out: investmentsRunOut, largest_shortfall: largestShortfall } = forecast.warnings;
  const warnings = [];
  if (cashRunsOut) {
    warnings.push(createElement("p", "fc-warning", `Your cash runs out in ${formatMonthYear(cashRunsOut.date)}: from then, investments are sold to cover what's missing.`));
  }
  if (investmentsRunOut) {
    warnings.push(createElement("p", "fc-warning danger",
      `Investments run out too in ${formatMonthYear(investmentsRunOut.date)}: after that you'd be short, up to ${wholeEuroFormatter.format(largestShortfall)} (in that month's euros).`));
  }
  const pastEvents = forecast.events.filter((event) => event.is_past);
  if (pastEvents.length) {
    warnings.push(createElement("p", "fc-warning muted", `Not counted, already past: ${pastEvents.map((event) => event.name).join(", ")}. Move them to a future month or delete them.`));
  }
  elementById("fc-warnings").replaceChildren(...warnings);
}

// ---------- chart ----------

function renderChart() {
  const chartBox = elementById("fc-chart");
  const history = forecast.history, future = forecast.forecast;
  const dates = [...history.map((point) => point.date), ...future.map((point) => point.date)];
  const valuesOf = (field) => [...history.map((point) => point[field]), ...future.map((point) => inChosenMoney(point[field], point.deflator))];
  const showBand = elementById("fc-show-band").checked;
  const bandOf = (bandValues) => [...history.map(() => null), ...bandValues.map((value, index) => inChosenMoney(value, future[index].deflator))];

  drawStackedAreaChart(chartBox, dates, [
    { name: "Cash", values: valuesOf("cash"), className: "fc-cash" },
    { name: "Investments", values: valuesOf("investments"), className: "fc-investments" },
    { name: "Personal use", values: valuesOf("personal_use"), className: "fc-personal-use" },
  ], "Net worth", {
    forecastFromIndex: history.length,
    band: showBand ? { low: bandOf(forecast.band.low), high: bandOf(forecast.band.high), label: `${percentFormatter.format(forecast.band.low_return)} – ${percentFormatter.format(forecast.band.high_return)} return` } : null,
  });
  elementById("fc-band-label").textContent = `${percentFormatter.format(forecast.band.low_return)} – ${percentFormatter.format(forecast.band.high_return)} return`;
}

function renderForecastResults() {
  if (!forecast) return;
  highlightSelectedChip(elementById("fc-money-view"), moneyView);
  highlightSelectedChip(elementById("fc-years"), String(yearsShown));
  renderKeyNumbers();
  renderWarnings();
  renderChart();
}

// ---------- buttons ----------

export function initializeForecastPage() {
  elementById("fc-money-view").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    moneyView = chip.dataset.value;
    saveSetting("forecastMoneyView", moneyView);
    renderForecastResults();
  });
  elementById("fc-years").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    yearsShown = Number(chip.dataset.value);
    saveSetting("forecastYears", String(yearsShown));
    loadForecast().catch((error) => { elementById("fc-error").textContent = error.message; });
  });
  elementById("fc-show-band").addEventListener("change", renderChart);
  initializeForecastPlanEditor({ getYearsShown: () => yearsShown, onForecastChanged: showForecast });

  // drawn at the real pixel size: redraw when the window (or the page) changes size
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => forecast && renderChart(), REDRAW_DELAY_AFTER_RESIZE_MILLISECONDS);
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#forecast" && forecast) setTimeout(renderChart); });
}
